import { describe, it, expect, beforeEach } from 'vitest';
import { computeDelta, type WaitStatsSnapshot, type WaitStatsDelta } from '../../collector/collectors/wait-stats.js';

function makeSnapshot(overrides: Partial<WaitStatsSnapshot> & { wait_type: string }): WaitStatsSnapshot {
  return {
    waiting_tasks_count: 0,
    wait_time_ms: 0,
    max_wait_time_ms: 0,
    signal_wait_time_ms: 0,
    collected_at_utc: new Date(),
    ...overrides,
  };
}

describe('wait-stats delta computation', () => {
  it('computes correct deltas between snapshots', () => {
    const previous: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'CXPACKET', waiting_tasks_count: 100, wait_time_ms: 5000, signal_wait_time_ms: 200 }),
      makeSnapshot({ wait_type: 'LCK_M_X', waiting_tasks_count: 50, wait_time_ms: 3000, signal_wait_time_ms: 100 }),
    ];

    const current: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'CXPACKET', waiting_tasks_count: 150, wait_time_ms: 8000, max_wait_time_ms: 500, signal_wait_time_ms: 350 }),
      makeSnapshot({ wait_type: 'LCK_M_X', waiting_tasks_count: 75, wait_time_ms: 4500, max_wait_time_ms: 200, signal_wait_time_ms: 150 }),
    ];

    const deltas = computeDelta(current, previous);

    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toEqual({
      wait_type: 'CXPACKET',
      waiting_tasks_count_delta: 50,
      wait_time_ms_delta: 3000,
      max_wait_time_ms: 500,
      signal_wait_time_ms_delta: 150,
    });
    expect(deltas[1]).toEqual({
      wait_type: 'LCK_M_X',
      waiting_tasks_count_delta: 25,
      wait_time_ms_delta: 1500,
      max_wait_time_ms: 200,
      signal_wait_time_ms_delta: 50,
    });
  });

  it('skips wait types with no change (zero delta)', () => {
    const previous: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'CXPACKET', wait_time_ms: 5000 }),
    ];
    const current: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'CXPACKET', wait_time_ms: 5000 }),
    ];

    const deltas = computeDelta(current, previous);
    expect(deltas).toHaveLength(0);
  });

  it('skips wait types with negative delta (counter reset)', () => {
    const previous: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'CXPACKET', wait_time_ms: 10000 }),
    ];
    const current: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'CXPACKET', wait_time_ms: 500 }),
    ];

    const deltas = computeDelta(current, previous);
    expect(deltas).toHaveLength(0);
  });

  it('skips new wait types not present in previous snapshot', () => {
    const previous: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'CXPACKET', wait_time_ms: 1000 }),
    ];
    const current: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'CXPACKET', wait_time_ms: 2000 }),
      makeSnapshot({ wait_type: 'NEW_WAIT', wait_time_ms: 500 }),
    ];

    const deltas = computeDelta(current, previous);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].wait_type).toBe('CXPACKET');
  });

  it('returns empty array when previous snapshot is empty', () => {
    const current: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'CXPACKET', wait_time_ms: 5000 }),
    ];

    const deltas = computeDelta(current, []);
    expect(deltas).toHaveLength(0);
  });

  it('returns empty array when current snapshot is empty', () => {
    const previous: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'CXPACKET', wait_time_ms: 5000 }),
    ];

    const deltas = computeDelta([], previous);
    expect(deltas).toHaveLength(0);
  });
});
