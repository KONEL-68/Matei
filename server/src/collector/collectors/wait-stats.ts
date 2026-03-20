import type sql from 'mssql';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface WaitStatsSnapshot {
  wait_type: string;
  waiting_tasks_count: number;
  wait_time_ms: number;
  max_wait_time_ms: number;
  signal_wait_time_ms: number;
  collected_at_utc: Date;
}

export interface WaitStatsDelta {
  wait_type: string;
  waiting_tasks_count_delta: number;
  wait_time_ms_delta: number;
  max_wait_time_ms: number;
  signal_wait_time_ms_delta: number;
}

interface PreviousState {
  snapshot: WaitStatsSnapshot[];
  collectedAt: Date;
  sqlserverStartTime: Date;
}

// In-memory store for previous snapshots per instance
const previousSnapshots = new Map<number, PreviousState>();

// Load excluded waits from /sql/excluded_waits.json on startup.
// Tries multiple paths: project root (local dev), dist/sql (Docker), and relative paths.
function loadExcludedWaits(): Set<string> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(__dirname, '../../../../sql/excluded_waits.json'),  // src/collector/collectors/ → project /sql/
    path.resolve(__dirname, '../../sql/excluded_waits.json'),        // dist/collector/collectors/ → dist/sql/ (Docker)
  ];
  for (const candidate of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      return new Set(data as string[]);
    } catch { /* try next */ }
  }
  console.warn('Could not load excluded_waits.json, using empty set');
  return new Set();
}

const EXCLUDED_WAITS = loadExcludedWaits();

const QUERY = `
SELECT
    wait_type,
    waiting_tasks_count,
    wait_time_ms,
    max_wait_time_ms,
    signal_wait_time_ms,
    GETUTCDATE() AS collected_at_utc
FROM sys.dm_os_wait_stats
WHERE wait_time_ms > 0
ORDER BY wait_time_ms DESC
`;

/**
 * Compute delta between current and previous wait stats snapshots.
 * Exported for testing.
 */
export function computeDelta(
  current: WaitStatsSnapshot[],
  previous: WaitStatsSnapshot[],
): WaitStatsDelta[] {
  const prevMap = new Map(previous.map((r) => [r.wait_type, r]));
  const deltas: WaitStatsDelta[] = [];

  for (const curr of current) {
    const prev = prevMap.get(curr.wait_type);
    if (!prev) continue;

    const waitTimeDelta = curr.wait_time_ms - prev.wait_time_ms;
    if (waitTimeDelta <= 0) continue;

    deltas.push({
      wait_type: curr.wait_type,
      waiting_tasks_count_delta: curr.waiting_tasks_count - prev.waiting_tasks_count,
      wait_time_ms_delta: waitTimeDelta,
      max_wait_time_ms: curr.max_wait_time_ms,
      signal_wait_time_ms_delta: curr.signal_wait_time_ms - prev.signal_wait_time_ms,
    });
  }

  return deltas;
}

/**
 * Collect wait stats and compute delta.
 * Returns null on first collection or after instance restart (no delta available).
 */
export async function collectWaitStats(
  request: sql.Request,
  instanceId: number,
  sqlserverStartTime: Date,
): Promise<WaitStatsDelta[] | null> {
  const result = await request.query(QUERY);
  const rawRows = result.recordset as WaitStatsSnapshot[];

  // Filter excluded waits
  const currentSnapshot = rawRows.filter((r) => !EXCLUDED_WAITS.has(r.wait_type));
  const collectedAt = currentSnapshot[0]?.collected_at_utc ?? new Date();

  const prev = previousSnapshots.get(instanceId);

  // Store current snapshot for next cycle
  previousSnapshots.set(instanceId, {
    snapshot: currentSnapshot,
    collectedAt,
    sqlserverStartTime,
  });

  // First collection — no previous data
  if (!prev) {
    return null;
  }

  // Instance restarted — sqlserver_start_time changed
  if (prev.sqlserverStartTime.getTime() !== sqlserverStartTime.getTime()) {
    return null;
  }

  return computeDelta(currentSnapshot, prev.snapshot);
}

/** Clear stored snapshot for an instance (used when instance is removed). */
export function clearSnapshot(instanceId: number): void {
  previousSnapshots.delete(instanceId);
}

/** Reset all stored snapshots (used in testing). */
export function resetAllSnapshots(): void {
  previousSnapshots.clear();
}
