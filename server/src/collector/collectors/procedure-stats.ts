import type sql from 'mssql';

export interface ProcedureStatsSnapshot {
  key: string;
  database_id: number;
  object_id: number;
  database_name: string | null;
  procedure_name: string | null;
  execution_count: number;
  total_worker_time: number;
  total_elapsed_time: number;
  total_logical_reads: number;
  total_logical_writes: number;
  last_execution_time: Date;
  collected_at_utc: Date;
}

export interface ProcedureStatsDelta {
  database_name: string | null;
  procedure_name: string | null;
  execution_count_delta: number;
  cpu_ms_per_sec: number;
  elapsed_ms_per_sec: number;
  reads_per_sec: number;
  writes_per_sec: number;
  avg_cpu_ms: number;
  avg_elapsed_ms: number;
  avg_reads: number;
  avg_writes: number;
}

interface PreviousState {
  snapshot: Map<string, ProcedureStatsSnapshot>;
  collectedAt: Date;
  sqlserverStartTime: Date;
}

// In-memory store for previous snapshots per instance
const previousSnapshots = new Map<number, PreviousState>();

const QUERY = `
SELECT TOP 50
    ps.database_id,
    ps.object_id,
    ISNULL(DB_NAME(ps.database_id), '?') AS database_name,
    ISNULL(OBJECT_SCHEMA_NAME(ps.object_id, ps.database_id), 'dbo') + '.' + OBJECT_NAME(ps.object_id, ps.database_id) AS procedure_name,
    SUM(ps.execution_count) AS execution_count,
    SUM(ps.total_worker_time) AS total_worker_time,
    SUM(ps.total_elapsed_time) AS total_elapsed_time,
    SUM(ps.total_logical_reads) AS total_logical_reads,
    SUM(ps.total_logical_writes) AS total_logical_writes,
    MAX(ps.last_execution_time) AS last_execution_time,
    GETUTCDATE() AS collected_at_utc
FROM sys.dm_exec_procedure_stats ps
WHERE ps.database_id > 4
GROUP BY ps.database_id, ps.object_id
HAVING OBJECT_NAME(ps.object_id, ps.database_id) IS NOT NULL
ORDER BY SUM(ps.total_worker_time) DESC
`;

/**
 * Compute deltas between current and previous procedure stats snapshots.
 * Exported for testing.
 */
export function computeProcedureStatsDelta(
  current: ProcedureStatsSnapshot[],
  previous: Map<string, ProcedureStatsSnapshot>,
  elapsedSeconds: number,
): ProcedureStatsDelta[] {
  const deltas: ProcedureStatsDelta[] = [];
  const seconds = elapsedSeconds > 0 ? elapsedSeconds : 1;

  for (const curr of current) {
    const prev = previous.get(curr.key);
    if (!prev) continue; // New procedure — no previous data to delta against

    const execDelta = curr.execution_count - prev.execution_count;
    if (execDelta <= 0) continue; // No new executions or counter reset

    const cpuDelta = curr.total_worker_time - prev.total_worker_time;
    const elapsedDelta = curr.total_elapsed_time - prev.total_elapsed_time;
    const readsDelta = curr.total_logical_reads - prev.total_logical_reads;
    const writesDelta = curr.total_logical_writes - prev.total_logical_writes;

    // Skip if any counter went backwards (plan recompile / eviction)
    if (cpuDelta < 0 || elapsedDelta < 0 || readsDelta < 0) continue;

    // worker_time is in microseconds, convert to milliseconds for rates
    const cpuMsDelta = cpuDelta / 1000;
    const elapsedMsDelta = elapsedDelta / 1000;

    deltas.push({
      database_name: curr.database_name,
      procedure_name: curr.procedure_name,
      execution_count_delta: execDelta,
      cpu_ms_per_sec: cpuMsDelta / seconds,
      elapsed_ms_per_sec: elapsedMsDelta / seconds,
      reads_per_sec: readsDelta / seconds,
      writes_per_sec: writesDelta / seconds,
      avg_cpu_ms: cpuMsDelta / execDelta,
      avg_elapsed_ms: elapsedMsDelta / execDelta,
      avg_reads: readsDelta / execDelta,
      avg_writes: writesDelta / execDelta,
    });
  }

  return deltas;
}

/**
 * Collect procedure stats and compute delta.
 * Returns null on first collection or after instance restart.
 */
export async function collectProcedureStats(
  request: sql.Request,
  instanceId: number,
  sqlserverStartTime: Date,
): Promise<ProcedureStatsDelta[] | null> {
  const result = await request.query(QUERY);
  const rawRows = result.recordset as Array<{
    database_id: number;
    object_id: number;
    database_name: string | null;
    procedure_name: string | null;
    execution_count: number;
    total_worker_time: number;
    total_elapsed_time: number;
    total_logical_reads: number;
    total_logical_writes: number;
    last_execution_time: Date;
    collected_at_utc: Date;
  }>;
  const collectedAt = rawRows[0]?.collected_at_utc ?? new Date();

  // Build current snapshot map keyed by "database_id-object_id"
  const currentMap = new Map<string, ProcedureStatsSnapshot>();
  const snapshotRows: ProcedureStatsSnapshot[] = [];

  for (const row of rawRows) {
    const key = `${row.database_id}-${row.object_id}`;
    const snapshot: ProcedureStatsSnapshot = {
      key,
      database_id: row.database_id,
      object_id: row.object_id,
      database_name: row.database_name,
      procedure_name: row.procedure_name,
      execution_count: row.execution_count,
      total_worker_time: row.total_worker_time,
      total_elapsed_time: row.total_elapsed_time,
      total_logical_reads: row.total_logical_reads,
      total_logical_writes: row.total_logical_writes,
      last_execution_time: row.last_execution_time,
      collected_at_utc: row.collected_at_utc,
    };
    // Keep only the first entry per key (highest worker_time due to ORDER BY)
    if (!currentMap.has(key)) {
      currentMap.set(key, snapshot);
    }
    snapshotRows.push(snapshot);
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

  return computeProcedureStatsDelta(snapshotRows, prev.snapshot, elapsedSeconds);
}

/** Clear stored snapshot for an instance. */
export function clearProcedureStatsSnapshot(instanceId: number): void {
  previousSnapshots.delete(instanceId);
}

/** Reset all stored snapshots (used in testing). */
export function resetAllProcedureStatsSnapshots(): void {
  previousSnapshots.clear();
}
