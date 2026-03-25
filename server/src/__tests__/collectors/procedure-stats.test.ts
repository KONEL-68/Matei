import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeProcedureStatsDelta,
  collectProcedureStats,
  resetAllProcedureStatsSnapshots,
  type ProcedureStatsSnapshot,
} from '../../collector/collectors/procedure-stats.js';

function makeSnapshot(overrides: Partial<ProcedureStatsSnapshot> & { key: string }): ProcedureStatsSnapshot {
  return {
    database_id: 5,
    object_id: 1001,
    database_name: 'testdb',
    procedure_name: 'dbo.usp_GetOrders',
    execution_count: 0,
    total_worker_time: 0,
    total_elapsed_time: 0,
    total_logical_reads: 0,
    total_logical_writes: 0,
    last_execution_time: new Date('2026-03-20T10:00:00Z'),
    collected_at_utc: new Date('2026-03-20T10:00:00Z'),
    ...overrides,
  };
}

describe('procedure-stats delta computation', () => {
  it('computes correct deltas for execution_count, worker_time, logical_reads', () => {
    const prev = new Map<string, ProcedureStatsSnapshot>();
    prev.set('5-1001', makeSnapshot({
      key: '5-1001',
      execution_count: 100,
      total_worker_time: 5_000_000,   // 5000ms in microseconds
      total_elapsed_time: 10_000_000,
      total_logical_reads: 50000,
      total_logical_writes: 1000,
    }));

    const current = [
      makeSnapshot({
        key: '5-1001',
        execution_count: 150,          // +50
        total_worker_time: 8_000_000,  // +3000ms in microseconds
        total_elapsed_time: 15_000_000, // +5000ms
        total_logical_reads: 75000,    // +25000
        total_logical_writes: 1500,    // +500
      }),
    ];

    const deltas = computeProcedureStatsDelta(current, prev, 60);
    expect(deltas).toHaveLength(1);

    const d = deltas[0];
    expect(d.procedure_name).toBe('dbo.usp_GetOrders');
    expect(d.execution_count_delta).toBe(50);

    // cpu_ms_per_sec = (3_000_000 / 1000) / 60 = 50 ms/sec
    expect(d.cpu_ms_per_sec).toBe(50);
    // elapsed_ms_per_sec = (5_000_000 / 1000) / 60 = 83.33 ms/sec
    expect(d.elapsed_ms_per_sec).toBeCloseTo(83.33, 1);
    // reads_per_sec = 25000 / 60 = 416.67
    expect(d.reads_per_sec).toBeCloseTo(416.67, 0);
    // writes_per_sec = 500 / 60 = 8.33
    expect(d.writes_per_sec).toBeCloseTo(8.33, 1);
  });

  it('computes correct per-execution averages', () => {
    const prev = new Map<string, ProcedureStatsSnapshot>();
    prev.set('5-2002', makeSnapshot({
      key: '5-2002',
      execution_count: 100,
      total_worker_time: 2_000_000,
      total_elapsed_time: 4_000_000,
      total_logical_reads: 10000,
      total_logical_writes: 200,
    }));

    const current = [
      makeSnapshot({
        key: '5-2002',
        execution_count: 110,          // +10
        total_worker_time: 3_000_000,  // +1000ms = 1_000_000us
        total_elapsed_time: 6_000_000, // +2000ms
        total_logical_reads: 12000,    // +2000
        total_logical_writes: 300,     // +100
      }),
    ];

    const deltas = computeProcedureStatsDelta(current, prev, 30);
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
    resetAllProcedureStatsSnapshots();
    const mockRequest = {
      query: async () => ({
        recordset: [
          {
            database_id: 5, object_id: 1001,
            database_name: 'testdb', procedure_name: 'dbo.usp_GetOrders',
            execution_count: 100, total_worker_time: 5000000,
            total_elapsed_time: 10000000, total_logical_reads: 50000,
            total_logical_writes: 1000, last_execution_time: new Date(),
            collected_at_utc: new Date('2026-03-20T10:00:00Z'),
          },
        ],
      }),
    } as never;

    const startTime = new Date('2026-03-20T09:00:00Z');
    const result = await collectProcedureStats(mockRequest, 1, startTime);
    expect(result).toBeNull();
  });

  it('second collection produces deltas', async () => {
    resetAllProcedureStatsSnapshots();
    const startTime = new Date('2026-03-20T09:00:00Z');

    const mock1 = {
      query: async () => ({
        recordset: [
          {
            database_id: 5, object_id: 1001,
            database_name: 'testdb', procedure_name: 'dbo.usp_GetOrders',
            execution_count: 100, total_worker_time: 5_000_000,
            total_elapsed_time: 10_000_000, total_logical_reads: 10000,
            total_logical_writes: 500, last_execution_time: new Date(),
            collected_at_utc: new Date('2026-03-20T10:00:00Z'),
          },
        ],
      }),
    } as never;
    await collectProcedureStats(mock1, 10, startTime);

    const mock2 = {
      query: async () => ({
        recordset: [
          {
            database_id: 5, object_id: 1001,
            database_name: 'testdb', procedure_name: 'dbo.usp_GetOrders',
            execution_count: 120, total_worker_time: 7_000_000,
            total_elapsed_time: 14_000_000, total_logical_reads: 14000,
            total_logical_writes: 700, last_execution_time: new Date(),
            collected_at_utc: new Date('2026-03-20T10:01:00Z'),
          },
        ],
      }),
    } as never;
    const result = await collectProcedureStats(mock2, 10, startTime);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0].execution_count_delta).toBe(20);
  });

  it('new procedure appears — skip delta (no previous data for it)', () => {
    const prev = new Map<string, ProcedureStatsSnapshot>();
    prev.set('5-1001', makeSnapshot({
      key: '5-1001',
      execution_count: 100,
      total_worker_time: 5_000_000,
      total_logical_reads: 10000,
    }));

    const current = [
      makeSnapshot({
        key: '5-1001', execution_count: 110,
        total_worker_time: 6_000_000, total_logical_reads: 11000,
      }),
      makeSnapshot({
        key: '5-2002', execution_count: 5,
        total_worker_time: 500_000, total_logical_reads: 100,
        procedure_name: 'dbo.usp_NewProc',
      }),
    ];

    const deltas = computeProcedureStatsDelta(current, prev, 30);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].procedure_name).toBe('dbo.usp_GetOrders');
  });

  it('counter reset (plan recompile) produces no delta for that procedure', () => {
    const prev = new Map<string, ProcedureStatsSnapshot>();
    prev.set('5-1001', makeSnapshot({
      key: '5-1001',
      execution_count: 100,
      total_worker_time: 5_000_000,
      total_logical_reads: 10000,
    }));

    // Same key but counters reset (execution_count went down)
    const current = [
      makeSnapshot({
        key: '5-1001', execution_count: 5,
        total_worker_time: 200_000, total_logical_reads: 50,
      }),
    ];

    const deltas = computeProcedureStatsDelta(current, prev, 30);
    expect(deltas).toHaveLength(0);
  });

  it('instance restart resets baseline (returns null)', async () => {
    resetAllProcedureStatsSnapshots();
    const startTime1 = new Date('2026-03-20T09:00:00Z');
    const startTime2 = new Date('2026-03-20T11:00:00Z'); // different = restart

    const mock1 = {
      query: async () => ({
        recordset: [
          {
            database_id: 5, object_id: 1001,
            database_name: 'testdb', procedure_name: 'dbo.usp_GetOrders',
            execution_count: 100, total_worker_time: 5_000_000,
            total_elapsed_time: 10_000_000, total_logical_reads: 10000,
            total_logical_writes: 500, last_execution_time: new Date(),
            collected_at_utc: new Date('2026-03-20T10:00:00Z'),
          },
        ],
      }),
    } as never;
    await collectProcedureStats(mock1, 20, startTime1);

    const mock2 = {
      query: async () => ({
        recordset: [
          {
            database_id: 5, object_id: 1001,
            database_name: 'testdb', procedure_name: 'dbo.usp_GetOrders',
            execution_count: 10, total_worker_time: 500_000,
            total_elapsed_time: 1_000_000, total_logical_reads: 1000,
            total_logical_writes: 50, last_execution_time: new Date(),
            collected_at_utc: new Date('2026-03-20T11:01:00Z'),
          },
        ],
      }),
    } as never;
    const result = await collectProcedureStats(mock2, 20, startTime2);

    expect(result).toBeNull();
  });
});
