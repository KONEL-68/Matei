import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeQueryStatsDelta,
  collectQueryStats,
  resetAllSnapshots,
  type QueryStatsSnapshot,
} from '../../collector/collectors/query-stats.js';

function makeSnapshot(overrides: Partial<QueryStatsSnapshot> & { query_hash: string }): QueryStatsSnapshot {
  return {
    sql_handle: Buffer.from('test'),
    statement_start_offset: 0,
    statement_end_offset: -1,
    execution_count: 0,
    total_worker_time: 0,
    total_elapsed_time: 0,
    total_logical_reads: 0,
    total_physical_reads: 0,
    total_logical_writes: 0,
    total_rows: 0,
    creation_time: new Date('2026-03-20T09:00:00Z'),
    last_execution_time: new Date('2026-03-20T10:00:00Z'),
    database_name: 'testdb',
    statement_text: 'SELECT 1',
    last_grant_kb: null,
    last_used_grant_kb: null,
    collected_at_utc: new Date('2026-03-20T10:00:00Z'),
    ...overrides,
  };
}

describe('query-stats delta computation', () => {
  it('computes correct deltas for execution_count, worker_time, logical_reads', () => {
    const prev = new Map<string, QueryStatsSnapshot>();
    prev.set('0xABC', makeSnapshot({
      query_hash: '0xABC',
      execution_count: 100,
      total_worker_time: 5_000_000,   // 5000ms in microseconds
      total_elapsed_time: 10_000_000,
      total_logical_reads: 50000,
      total_logical_writes: 1000,
      total_rows: 10000,
    }));

    const current = [
      makeSnapshot({
        query_hash: '0xABC',
        execution_count: 150,          // +50
        total_worker_time: 8_000_000,  // +3000ms in microseconds
        total_elapsed_time: 15_000_000, // +5000ms
        total_logical_reads: 75000,    // +25000
        total_logical_writes: 1500,    // +500
        total_rows: 15000,             // +5000
      }),
    ];

    const deltas = computeQueryStatsDelta(current, prev, 60);
    expect(deltas).toHaveLength(1);

    const d = deltas[0];
    expect(d.query_hash).toBe('0xABC');
    expect(d.execution_count_delta).toBe(50);

    // cpu_ms_per_sec = (3_000_000 / 1000) / 60 = 50 ms/sec
    expect(d.cpu_ms_per_sec).toBe(50);
    // elapsed_ms_per_sec = (5_000_000 / 1000) / 60 = 83.33 ms/sec
    expect(d.elapsed_ms_per_sec).toBeCloseTo(83.33, 1);
    // reads_per_sec = 25000 / 60 = 416.67
    expect(d.reads_per_sec).toBeCloseTo(416.67, 0);
    // writes_per_sec = 500 / 60 = 8.33
    expect(d.writes_per_sec).toBeCloseTo(8.33, 1);
    // rows_per_sec = 5000 / 60 = 83.33
    expect(d.rows_per_sec).toBeCloseTo(83.33, 1);
  });

  it('computes correct per-execution averages', () => {
    const prev = new Map<string, QueryStatsSnapshot>();
    prev.set('0xDEF', makeSnapshot({
      query_hash: '0xDEF',
      execution_count: 100,
      total_worker_time: 2_000_000,
      total_elapsed_time: 4_000_000,
      total_logical_reads: 10000,
      total_logical_writes: 200,
      total_rows: 5000,
    }));

    const current = [
      makeSnapshot({
        query_hash: '0xDEF',
        execution_count: 110,          // +10
        total_worker_time: 3_000_000,  // +1000ms = 1_000_000us
        total_elapsed_time: 6_000_000, // +2000ms
        total_logical_reads: 12000,    // +2000
        total_logical_writes: 300,     // +100
        total_rows: 6000,
      }),
    ];

    const deltas = computeQueryStatsDelta(current, prev, 30);
    const d = deltas[0];

    // avg_cpu_ms = 1000ms / 10 executions = 100ms
    expect(d.avg_cpu_ms).toBe(100);
    // avg_elapsed_ms = 2000ms / 10 = 200ms
    expect(d.avg_elapsed_ms).toBe(200);
    // avg_reads = 2000 / 10 = 200
    expect(d.avg_reads).toBe(200);
    // avg_writes = 100 / 10 = 10
    expect(d.avg_writes).toBe(10);
  });

  it('first collection stores snapshot, produces no DB write (returns null)', async () => {
    resetAllSnapshots();
    const mockRequest = {
      query: async () => ({
        recordset: [
          makeSnapshot({ query_hash: '0xABC', execution_count: 100, total_worker_time: 5000000 }),
        ],
      }),
    } as never;

    const startTime = new Date('2026-03-20T09:00:00Z');
    const result = await collectQueryStats(mockRequest, 1, startTime);
    expect(result).toBeNull();
  });

  it('second collection produces deltas', async () => {
    resetAllSnapshots();
    const startTime = new Date('2026-03-20T09:00:00Z');

    const mock1 = {
      query: async () => ({
        recordset: [
          makeSnapshot({
            query_hash: '0xABC', execution_count: 100,
            total_worker_time: 5_000_000, total_logical_reads: 10000,
            collected_at_utc: new Date('2026-03-20T10:00:00Z'),
          }),
        ],
      }),
    } as never;
    await collectQueryStats(mock1, 10, startTime);

    const mock2 = {
      query: async () => ({
        recordset: [
          makeSnapshot({
            query_hash: '0xABC', execution_count: 120,
            total_worker_time: 7_000_000, total_logical_reads: 14000,
            collected_at_utc: new Date('2026-03-20T10:01:00Z'),
          }),
        ],
      }),
    } as never;
    const result = await collectQueryStats(mock2, 10, startTime);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0].execution_count_delta).toBe(20);
  });

  it('new query_hash appears — skip delta (no previous data for it)', () => {
    const prev = new Map<string, QueryStatsSnapshot>();
    prev.set('0xOLD', makeSnapshot({
      query_hash: '0xOLD',
      execution_count: 100,
      total_worker_time: 5_000_000,
      total_logical_reads: 10000,
    }));

    const current = [
      makeSnapshot({
        query_hash: '0xOLD', execution_count: 110,
        total_worker_time: 6_000_000, total_logical_reads: 11000,
      }),
      makeSnapshot({
        query_hash: '0xNEW', execution_count: 5,
        total_worker_time: 500_000, total_logical_reads: 100,
      }),
    ];

    const deltas = computeQueryStatsDelta(current, prev, 30);
    // Only 0xOLD should produce a delta, 0xNEW should be skipped
    expect(deltas).toHaveLength(1);
    expect(deltas[0].query_hash).toBe('0xOLD');
  });

  it('query disappears from DMV (plan evicted) — no negative delta', () => {
    const prev = new Map<string, QueryStatsSnapshot>();
    prev.set('0xEVICTED', makeSnapshot({
      query_hash: '0xEVICTED',
      execution_count: 100,
      total_worker_time: 5_000_000,
      total_logical_reads: 10000,
    }));
    prev.set('0xSTILL', makeSnapshot({
      query_hash: '0xSTILL',
      execution_count: 50,
      total_worker_time: 2_000_000,
      total_logical_reads: 5000,
    }));

    // Only 0xSTILL appears in current (0xEVICTED was evicted from plan cache)
    const current = [
      makeSnapshot({
        query_hash: '0xSTILL', execution_count: 60,
        total_worker_time: 3_000_000, total_logical_reads: 6000,
      }),
    ];

    const deltas = computeQueryStatsDelta(current, prev, 30);
    // Only 0xSTILL should have a delta, no negative/phantom for 0xEVICTED
    expect(deltas).toHaveLength(1);
    expect(deltas[0].query_hash).toBe('0xSTILL');
  });

  it('counter reset (plan recompile) produces no delta for that query', () => {
    const prev = new Map<string, QueryStatsSnapshot>();
    prev.set('0xRESET', makeSnapshot({
      query_hash: '0xRESET',
      execution_count: 100,
      total_worker_time: 5_000_000,
      total_logical_reads: 10000,
    }));

    // Same hash but counters reset (execution_count went down)
    const current = [
      makeSnapshot({
        query_hash: '0xRESET', execution_count: 5,
        total_worker_time: 200_000, total_logical_reads: 50,
      }),
    ];

    const deltas = computeQueryStatsDelta(current, prev, 30);
    expect(deltas).toHaveLength(0);
  });
});
