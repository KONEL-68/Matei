import type sql from 'mssql';

export interface DatabaseMetricSnapshot {
  database_name: string;
  counter_name: string;
  cntr_value: number;
  cntr_type: number;
}

export interface DatabaseMetricResult {
  database_name: string;
  counter_name: string;
  cntr_value: number;
}

interface PreviousState {
  snapshot: DatabaseMetricSnapshot[];
  collectedAt: Date;
  sqlserverStartTime: Date;
}

// In-memory store for previous snapshots per instance (for delta computation)
const previousSnapshots = new Map<number, PreviousState>();

// cntr_type 272696576 = cumulative per-second rate counters (need delta)
const RATE_COUNTER_TYPE = 272696576;

const QUERY = `
SELECT
    RTRIM(instance_name) AS database_name,
    RTRIM(counter_name) AS counter_name,
    cntr_value,
    cntr_type
FROM sys.dm_os_performance_counters
WHERE object_name LIKE '%:Databases%'
  AND instance_name NOT IN ('_Total', 'mssqlsystemresource')
  AND counter_name IN (
    'Data File(s) Size (KB)',
    'Log File(s) Size (KB)',
    'Log File(s) Used Size (KB)',
    'Transactions/sec',
    'Write Transactions/sec',
    'Active Transactions',
    'Log Flushes/sec',
    'Log Bytes Flushed/sec',
    'Log Flush Waits/sec'
  )
`;

/**
 * Compute per-second rates for cumulative counters and pass through instantaneous ones.
 * Exported for testing.
 */
export function computeDatabaseMetricValues(
  current: DatabaseMetricSnapshot[],
  previous: DatabaseMetricSnapshot[],
  elapsedSeconds: number,
): DatabaseMetricResult[] {
  // Build lookup keyed by "database_name|counter_name"
  const prevMap = new Map(
    previous.map((r) => [`${r.database_name}|${r.counter_name}`, r]),
  );
  const results: DatabaseMetricResult[] = [];
  const seconds = elapsedSeconds > 0 ? elapsedSeconds : 1;

  for (const curr of current) {
    if (curr.cntr_type === RATE_COUNTER_TYPE) {
      const key = `${curr.database_name}|${curr.counter_name}`;
      const prev = prevMap.get(key);
      if (!prev) continue;
      const delta = curr.cntr_value - prev.cntr_value;
      if (delta < 0) continue; // Counter wrapped or reset
      results.push({
        database_name: curr.database_name,
        counter_name: curr.counter_name,
        cntr_value: Math.round((delta / seconds) * 100) / 100,
      });
    } else {
      results.push({
        database_name: curr.database_name,
        counter_name: curr.counter_name,
        cntr_value: curr.cntr_value,
      });
    }
  }

  return results;
}

/**
 * Collect per-database performance counters and compute deltas for rate counters.
 * Returns null on first collection or after instance restart.
 */
export async function collectDatabaseMetrics(
  request: sql.Request,
  instanceId: number,
  sqlserverStartTime: Date,
): Promise<DatabaseMetricResult[] | null> {
  const result = await request.query(QUERY);
  const currentSnapshot = result.recordset as DatabaseMetricSnapshot[];
  const collectedAt = new Date();

  const prev = previousSnapshots.get(instanceId);

  // Store current snapshot for next cycle
  previousSnapshots.set(instanceId, {
    snapshot: currentSnapshot,
    collectedAt,
    sqlserverStartTime,
  });

  // First collection — no previous data
  if (!prev) {
    // Return instantaneous counters immediately on first run
    return currentSnapshot
      .filter((c) => c.cntr_type !== RATE_COUNTER_TYPE)
      .map((c) => ({
        database_name: c.database_name,
        counter_name: c.counter_name,
        cntr_value: c.cntr_value,
      }));
  }

  // Instance restarted — sqlserver_start_time changed
  if (prev.sqlserverStartTime.getTime() !== sqlserverStartTime.getTime()) {
    return null;
  }

  const elapsedSeconds = (collectedAt.getTime() - prev.collectedAt.getTime()) / 1000;
  return computeDatabaseMetricValues(currentSnapshot, prev.snapshot, elapsedSeconds);
}

/** Clear stored snapshot for an instance. */
export function clearSnapshot(instanceId: number): void {
  previousSnapshots.delete(instanceId);
}

/** Reset all stored snapshots (used in testing). */
export function resetAllSnapshots(): void {
  previousSnapshots.clear();
}
