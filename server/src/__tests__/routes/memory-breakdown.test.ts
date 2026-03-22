import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { metricRoutes } from '../../routes/metrics.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('memory breakdown endpoint', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await metricRoutes(app, mockPool as never);
    await app.ready();
  });

  it('returns 5-value breakdown from perf_counters', async () => {
    // perf_counters query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { counter_name: 'Total Server Memory (KB)', cntr_value: '16777216' },   // 16 GB
        { counter_name: 'Target Server Memory (KB)', cntr_value: '14680064' },  // 14 GB
        { counter_name: 'Stolen Server Memory (KB)', cntr_value: '3170304' },   // ~3.1 GB
        { counter_name: 'Database Cache Memory (KB)', cntr_value: '6963200' },  // ~6.8 GB
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/memory/breakdown' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total_mb).toBe(16384);
    expect(body.target_mb).toBe(14336);
    expect(body.stolen_mb).toBe(3096);
    expect(body.database_cache_mb).toBe(6800);
    expect(body.deficit_mb).toBe(16384 - 14336);
  });

  it('falls back to os_memory when perf_counters empty', async () => {
    // perf_counters query returns empty
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // os_memory fallback
    mockPool.query.mockResolvedValueOnce({
      rows: [{ sql_committed_mb: 4096, sql_target_mb: 8192 }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/memory/breakdown' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total_mb).toBe(4096);
    expect(body.target_mb).toBe(8192);
    expect(body.stolen_mb).toBe(0);
    expect(body.database_cache_mb).toBe(0);
    expect(body.deficit_mb).toBe(4096 - 8192);
  });

  it('returns null when no data at all', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/memory/breakdown' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toBeNull();
  });

  it('handles perf_counters_raw table not existing', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('relation "perf_counters_raw" does not exist'));
    mockPool.query.mockResolvedValueOnce({
      rows: [{ sql_committed_mb: 2048, sql_target_mb: 4096 }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/memory/breakdown' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total_mb).toBe(2048);
    expect(body.target_mb).toBe(4096);
  });

  it('perf_counters query has no time filter — returns data regardless of age', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { counter_name: 'Total Server Memory (KB)', cntr_value: '8388608' },
        { counter_name: 'Target Server Memory (KB)', cntr_value: '8388608' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/memory/breakdown' });
    expect(res.statusCode).toBe(200);

    // The perf_counters query should NOT have a time filter
    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).not.toContain('NOW()');
    expect(sql).not.toContain('interval');
    expect(sql).not.toContain('5 minutes');
  });
});
