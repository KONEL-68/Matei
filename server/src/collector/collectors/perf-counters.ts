import type sql from 'mssql';

export interface PerfCounterSnapshot {
  counter_name: string;
  cntr_value: number;
  cntr_type: number;
}

export interface PerfCounterResult {
  counter_name: string;
  cntr_value: number;
}

interface PreviousState {
  snapshot: PerfCounterSnapshot[];
  collectedAt: Date;
  sqlserverStartTime: Date;
}

// In-memory store for previous snapshots per instance (for delta computation)
const previousSnapshots = new Map<number, PreviousState>();

// cntr_type 272696576 = cumulative per-second rate counters (need delta)
const RATE_COUNTER_TYPE = 272696576;

const QUERY = `
SELECT
    RTRIM(counter_name) AS counter_name,
    cntr_value,
    cntr_type
FROM sys.dm_os_performance_counters
WHERE (
    (RTRIM(counter_name) = 'Page life expectancy' AND object_name LIKE '%Buffer Manager%')
    OR (RTRIM(counter_name) = 'Batch Requests/sec' AND object_name LIKE '%SQL Statistics%')
    OR (RTRIM(counter_name) = 'SQL Compilations/sec' AND object_name LIKE '%SQL Statistics%')
    OR (RTRIM(counter_name) = 'SQL Re-Compilations/sec' AND object_name LIKE '%SQL Statistics%')
    OR (RTRIM(counter_name) = 'User Connections' AND object_name LIKE '%General Statistics%')
    OR (RTRIM(counter_name) = 'Processes blocked' AND object_name LIKE '%General Statistics%')
    OR (RTRIM(counter_name) = 'Logins/sec' AND object_name LIKE '%General Statistics%')
    OR (RTRIM(counter_name) = 'Logouts/sec' AND object_name LIKE '%General Statistics%')
    OR (RTRIM(counter_name) = 'Transactions/sec' AND object_name LIKE '%Databases%' AND instance_name = '_Total')
    OR (RTRIM(counter_name) = 'Deadlocks/sec' AND object_name LIKE '%Locks%' AND instance_name = '_Total')
    OR (RTRIM(counter_name) = 'Lazy writes/sec' AND object_name LIKE '%Buffer Manager%')
    OR (RTRIM(counter_name) = 'Checkpoint pages/sec' AND object_name LIKE '%Buffer Manager%')
    OR (RTRIM(counter_name) = 'Lock Waits/sec' AND object_name LIKE '%Locks%' AND instance_name = '_Total')
    OR (RTRIM(counter_name) = 'Database Cache Memory (KB)' AND object_name LIKE '%Memory Manager%')
    OR (RTRIM(counter_name) = 'SQL Cache Memory (KB)' AND object_name LIKE '%Memory Manager%')
)
`;

/**
 * Compute per-second rates for cumulative counters and pass through instantaneous ones.
 * Exported for testing.
 */
export function computePerfCounterValues(
  current: PerfCounterSnapshot[],
  previous: PerfCounterSnapshot[],
  elapsedSeconds: number,
): PerfCounterResult[] {
  const prevMap = new Map(previous.map((r) => [r.counter_name, r]));
  const results: PerfCounterResult[] = [];
  const seconds = elapsedSeconds > 0 ? elapsedSeconds : 1;

  for (const curr of current) {
    if (curr.cntr_type === RATE_COUNTER_TYPE) {
      // Cumulative rate counter — compute delta / elapsed seconds
      const prev = prevMap.get(curr.counter_name);
      if (!prev) continue;
      const delta = curr.cntr_value - prev.cntr_value;
      if (delta < 0) continue; // Counter wrapped or reset
      results.push({
        counter_name: curr.counter_name,
        cntr_value: Math.round((delta / seconds) * 100) / 100,
      });
    } else {
      // Instantaneous counter — store as-is
      results.push({
        counter_name: curr.counter_name,
        cntr_value: curr.cntr_value,
      });
    }
  }

  return results;
}

/**
 * Collect performance counters and compute deltas for rate counters.
 * Returns null on first collection or after instance restart.
 */
export async function collectPerfCounters(
  request: sql.Request,
  instanceId: number,
  sqlserverStartTime: Date,
): Promise<PerfCounterResult[] | null> {
  const result = await request.query(QUERY);
  const currentSnapshot = result.recordset as PerfCounterSnapshot[];
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
      .map((c) => ({ counter_name: c.counter_name, cntr_value: c.cntr_value }));
  }

  // Instance restarted — sqlserver_start_time changed
  if (prev.sqlserverStartTime.getTime() !== sqlserverStartTime.getTime()) {
    return null;
  }

  const elapsedSeconds = (collectedAt.getTime() - prev.collectedAt.getTime()) / 1000;
  return computePerfCounterValues(currentSnapshot, prev.snapshot, elapsedSeconds);
}

/** Clear stored snapshot for an instance. */
export function clearSnapshot(instanceId: number): void {
  previousSnapshots.delete(instanceId);
}

/** Reset all stored snapshots (used in testing). */
export function resetAllSnapshots(): void {
  previousSnapshots.clear();
}
