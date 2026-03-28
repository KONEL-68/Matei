import type sql from 'mssql';

export interface QueryStatsSnapshot {
  query_hash: string;
  sql_handle: Buffer;
  statement_start_offset: number;
  statement_end_offset: number;
  execution_count: number;
  total_worker_time: number;
  total_elapsed_time: number;
  total_logical_reads: number;
  total_logical_writes: number;
  total_rows: number;
  creation_time: Date;
  last_execution_time: Date;
  database_name: string | null;
  statement_text: string | null;
  last_grant_kb: number | null;
  last_used_grant_kb: number | null;
  collected_at_utc: Date;
}

export interface QueryStatsDelta {
  query_hash: string;
  statement_text: string | null;
  database_name: string | null;
  execution_count_delta: number;
  cpu_ms_per_sec: number;
  elapsed_ms_per_sec: number;
  reads_per_sec: number;
  writes_per_sec: number;
  rows_per_sec: number;
  avg_cpu_ms: number;
  avg_elapsed_ms: number;
  avg_reads: number;
  avg_writes: number;
  last_grant_kb: number | null;
  last_used_grant_kb: number | null;
}

interface PreviousState {
  snapshot: Map<string, QueryStatsSnapshot>;
  collectedAt: Date;
  sqlserverStartTime: Date;
}

// In-memory store for previous snapshots per instance
const previousSnapshots = new Map<number, PreviousState>();

const QUERY = `
SELECT TOP 50
    CONVERT(VARCHAR(100), qs.query_hash, 1) AS query_hash,
    qs.sql_handle,
    qs.statement_start_offset,
    qs.statement_end_offset,
    qs.execution_count,
    qs.total_worker_time,
    qs.total_elapsed_time,
    qs.total_logical_reads,
    qs.total_logical_writes,
    qs.total_rows,
    qs.creation_time,
    qs.last_execution_time,
    COALESCE(DB_NAME(st.dbid), DB_NAME(CONVERT(INT, pa.value))) AS database_name,
    SUBSTRING(
        st.text,
        (qs.statement_start_offset / 2) + 1,
        (CASE
            WHEN qs.statement_end_offset = -1
            THEN DATALENGTH(st.text)
            ELSE qs.statement_end_offset
        END - qs.statement_start_offset) / 2 + 1
    ) AS statement_text,
    qs.last_grant_kb,
    qs.last_used_grant_kb,
    GETUTCDATE() AS collected_at_utc
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
OUTER APPLY (
    SELECT TOP 1 CAST(value AS SQL_VARIANT) AS value
    FROM sys.dm_exec_plan_attributes(qs.plan_handle)
    WHERE attribute = 'dbid'
) pa
ORDER BY qs.total_worker_time DESC
`;

/**
 * Compute deltas between current and previous query stats snapshots.
 * Exported for testing.
 */
export function computeQueryStatsDelta(
  current: QueryStatsSnapshot[],
  previous: Map<string, QueryStatsSnapshot>,
  elapsedSeconds: number,
): QueryStatsDelta[] {
  const deltas: QueryStatsDelta[] = [];
  const seconds = elapsedSeconds > 0 ? elapsedSeconds : 1;

  for (const curr of current) {
    const prev = previous.get(curr.query_hash);
    if (!prev) continue; // New query — no previous data to delta against

    const execDelta = curr.execution_count - prev.execution_count;
    if (execDelta <= 0) continue; // No new executions or counter reset

    const cpuDelta = curr.total_worker_time - prev.total_worker_time;
    const elapsedDelta = curr.total_elapsed_time - prev.total_elapsed_time;
    const readsDelta = curr.total_logical_reads - prev.total_logical_reads;
    const writesDelta = curr.total_logical_writes - prev.total_logical_writes;
    const rowsDelta = curr.total_rows - prev.total_rows;

    // Skip if any counter went backwards (plan recompile / eviction)
    if (cpuDelta < 0 || elapsedDelta < 0 || readsDelta < 0) continue;

    // worker_time is in microseconds, convert to milliseconds for rates
    const cpuMsDelta = cpuDelta / 1000;
    const elapsedMsDelta = elapsedDelta / 1000;

    deltas.push({
      query_hash: curr.query_hash,
      statement_text: curr.statement_text,
      database_name: curr.database_name,
      execution_count_delta: execDelta,
      cpu_ms_per_sec: cpuMsDelta / seconds,
      elapsed_ms_per_sec: elapsedMsDelta / seconds,
      reads_per_sec: readsDelta / seconds,
      writes_per_sec: writesDelta / seconds,
      rows_per_sec: rowsDelta / seconds,
      avg_cpu_ms: cpuMsDelta / execDelta,
      avg_elapsed_ms: elapsedMsDelta / execDelta,
      avg_reads: readsDelta / execDelta,
      avg_writes: writesDelta / execDelta,
      last_grant_kb: curr.last_grant_kb,
      last_used_grant_kb: curr.last_used_grant_kb,
    });
  }

  return deltas;
}

/**
 * Collect query stats and compute delta.
 * Returns null on first collection or after instance restart.
 */
export async function collectQueryStats(
  request: sql.Request,
  instanceId: number,
  sqlserverStartTime: Date,
): Promise<QueryStatsDelta[] | null> {
  const result = await request.query(QUERY);
  const rawRows = result.recordset as QueryStatsSnapshot[];
  const collectedAt = rawRows[0]?.collected_at_utc ?? new Date();

  // Build current snapshot map keyed by query_hash
  const currentMap = new Map<string, QueryStatsSnapshot>();
  for (const row of rawRows) {
    // Keep only the first entry per query_hash (highest worker_time due to ORDER BY)
    if (!currentMap.has(row.query_hash)) {
      currentMap.set(row.query_hash, row);
    }
  }

  const prev = previousSnapshots.get(instanceId);

  // Store current snapshot for next cycle
  previousSnapshots.set(instanceId, {
    snapshot: currentMap,
    collectedAt,
    sqlserverStartTime,
  });

  // First collection — no previous data
  if (!prev) {
    return null;
  }

  // Instance restarted
  if (prev.sqlserverStartTime.getTime() !== sqlserverStartTime.getTime()) {
    return null;
  }

  const elapsedSeconds = (collectedAt.getTime() - prev.collectedAt.getTime()) / 1000;

  return computeQueryStatsDelta(rawRows, prev.snapshot, elapsedSeconds);
}

/** Clear stored snapshot for an instance. */
export function clearSnapshot(instanceId: number): void {
  previousSnapshots.delete(instanceId);
}

/** Reset all stored snapshots (used in testing). */
export function resetAllSnapshots(): void {
  previousSnapshots.clear();
}
