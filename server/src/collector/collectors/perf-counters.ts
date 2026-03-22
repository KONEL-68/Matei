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
WHERE counter_name IN (
    'Batch Requests/sec',
    'SQL Compilations/sec',
    'SQL Re-Compilations/sec',
    'Logins/sec',
    'Logouts/sec',
    'Transactions/sec',
    'User Connections',
    'Processes blocked',
    'Page life expectancy',
    'Lazy writes/sec',
    'Checkpoint pages/sec',
    'Lock Waits/sec',
    'Deadlocks/sec'
)
AND instance_name IN ('', '_Total')
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
