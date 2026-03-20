import { describe, it, expect, beforeEach } from 'vitest';
import { computeDelta, resetAllSnapshots, collectWaitStats, type WaitStatsSnapshot } from '../../collector/collectors/wait-stats.js';

function makeSnapshot(overrides: Partial<WaitStatsSnapshot> & { wait_type: string }): WaitStatsSnapshot {
  return {
    waiting_tasks_count: 0,
    wait_time_ms: 0,
    max_wait_time_ms: 0,
    signal_wait_time_ms: 0,
    collected_at_utc: new Date('2026-03-20T10:00:00Z'),
    ...overrides,
  };
}

describe('wait-stats delta output format', () => {
  beforeEach(() => {
    resetAllSnapshots();
  });

  it('delta output has correct fields: wait_type, wait_time_ms_delta, waiting_tasks_count_delta', () => {
    const previous: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'CXPACKET', waiting_tasks_count: 100, wait_time_ms: 5000, signal_wait_time_ms: 200 }),
    ];

    const current: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'CXPACKET', waiting_tasks_count: 150, wait_time_ms: 8000, max_wait_time_ms: 500, signal_wait_time_ms: 350 }),
    ];

    const deltas = computeDelta(current, previous);

    expect(deltas).toHaveLength(1);
    const d = deltas[0];

    // Verify all expected fields exist
    expect(d).toHaveProperty('wait_type');
    expect(d).toHaveProperty('wait_time_ms_delta');
    expect(d).toHaveProperty('waiting_tasks_count_delta');
    expect(d).toHaveProperty('max_wait_time_ms');
    expect(d).toHaveProperty('signal_wait_time_ms_delta');

    // Verify values are deltas, not cumulative
    expect(d.wait_type).toBe('CXPACKET');
    expect(d.wait_time_ms_delta).toBe(3000); // 8000 - 5000
    expect(d.waiting_tasks_count_delta).toBe(50); // 150 - 100
    expect(d.signal_wait_time_ms_delta).toBe(150); // 350 - 200
    expect(d.max_wait_time_ms).toBe(500); // current max (not delta)
  });

  it('can compute per-second rate from delta', () => {
    const previous: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'LCK_M_X', wait_time_ms: 1000 }),
    ];
    const current: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'LCK_M_X', wait_time_ms: 1900 }),
    ];

    const deltas = computeDelta(current, previous);
    expect(deltas).toHaveLength(1);

    // 900ms delta / 30s interval = 30 ms/sec
    const COLLECTION_INTERVAL_SECONDS = 30;
    const waitMsPerSec = deltas[0].wait_time_ms_delta / COLLECTION_INTERVAL_SECONDS;
    expect(waitMsPerSec).toBe(30);

    // Also verify waits_per_sec is computable
    const previous2: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'LCK_M_X', waiting_tasks_count: 100, wait_time_ms: 1000 }),
    ];
    const current2: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'LCK_M_X', waiting_tasks_count: 160, wait_time_ms: 1900 }),
    ];
    const deltas2 = computeDelta(current2, previous2);
    const waitsPerSec = deltas2[0].waiting_tasks_count_delta / COLLECTION_INTERVAL_SECONDS;
    expect(waitsPerSec).toBe(2); // 60 tasks / 30s
  });

  it('first cycle produces no DB write (returns null)', async () => {
    // Create a mock request that returns data
    const mockRequest = {
      query: async () => ({
        recordset: [
          makeSnapshot({ wait_type: 'CXPACKET', wait_time_ms: 5000 }),
          makeSnapshot({ wait_type: 'LCK_M_X', wait_time_ms: 3000 }),
        ],
      }),
    } as never;

    const startTime = new Date('2026-03-20T09:00:00Z');
    const result = await collectWaitStats(mockRequest, 1, startTime);

    // First cycle should return null — nothing to write to DB
    expect(result).toBeNull();
  });

  it('second cycle produces delta values', async () => {
    const startTime = new Date('2026-03-20T09:00:00Z');

    // First cycle
    const mockRequest1 = {
      query: async () => ({
        recordset: [
          makeSnapshot({ wait_type: 'CXPACKET', waiting_tasks_count: 100, wait_time_ms: 5000 }),
        ],
      }),
    } as never;
    const result1 = await collectWaitStats(mockRequest1, 1, startTime);
    expect(result1).toBeNull();

    // Second cycle — values increased
    const mockRequest2 = {
      query: async () => ({
        recordset: [
          makeSnapshot({ wait_type: 'CXPACKET', waiting_tasks_count: 150, wait_time_ms: 8000, max_wait_time_ms: 200 }),
        ],
      }),
    } as never;
    const result2 = await collectWaitStats(mockRequest2, 1, startTime);
    expect(result2).not.toBeNull();
    expect(result2).toHaveLength(1);
    expect(result2![0].wait_time_ms_delta).toBe(3000);
    expect(result2![0].waiting_tasks_count_delta).toBe(50);
  });

  it('negative delta (counter reset) is skipped', () => {
    const previous: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'CXPACKET', wait_time_ms: 10000 }),
      makeSnapshot({ wait_type: 'LCK_M_X', wait_time_ms: 5000 }),
    ];
    const current: WaitStatsSnapshot[] = [
      makeSnapshot({ wait_type: 'CXPACKET', wait_time_ms: 500 }),   // Counter reset
      makeSnapshot({ wait_type: 'LCK_M_X', wait_time_ms: 6000 }),   // Normal increase
    ];

    const deltas = computeDelta(current, previous);

    // CXPACKET should be skipped (negative delta), only LCK_M_X remains
    expect(deltas).toHaveLength(1);
    expect(deltas[0].wait_type).toBe('LCK_M_X');
    expect(deltas[0].wait_time_ms_delta).toBe(1000);
  });

  it('instance restart returns null (detected via sqlserver_start_time)', async () => {
    const startTime1 = new Date('2026-03-20T09:00:00Z');
    const startTime2 = new Date('2026-03-20T10:30:00Z'); // Server restarted

    // First cycle
    const mockRequest1 = {
      query: async () => ({
        recordset: [
          makeSnapshot({ wait_type: 'CXPACKET', wait_time_ms: 5000 }),
        ],
      }),
    } as never;
    await collectWaitStats(mockRequest1, 2, startTime1);

    // Second cycle — start time changed (restart)
    const mockRequest2 = {
      query: async () => ({
        recordset: [
          makeSnapshot({ wait_type: 'CXPACKET', wait_time_ms: 100 }),
        ],
      }),
    } as never;
    const result = await collectWaitStats(mockRequest2, 2, startTime2);
    expect(result).toBeNull(); // Should skip delta computation
  });
});
