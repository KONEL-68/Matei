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

  it('returns memory breakdown with all components', async () => {
    // os_memory query
    mockPool.query.mockResolvedValueOnce({
      rows: [{ sql_committed_mb: 4096, sql_target_mb: 8192 }],
    });
    // perf_counters cache query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { counter_name: 'Database Cache Memory (KB)', cntr_value: '3145728' }, // 3 GB
        { counter_name: 'SQL Cache Memory (KB)', cntr_value: '524288' }, // 512 MB
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/memory/breakdown' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sql_committed_mb).toBe(4096);
    expect(body.sql_target_mb).toBe(8192);
    expect(body.buffer_pool_mb).toBe(3072);
    expect(body.plan_cache_mb).toBe(512);
  });

  it('returns null when no memory data', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/memory/breakdown' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toBeNull();
  });

  it('returns zeros for cache when perf_counters not yet available', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ sql_committed_mb: 2048, sql_target_mb: 4096 }],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/memory/breakdown' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.buffer_pool_mb).toBe(0);
    expect(body.plan_cache_mb).toBe(0);
  });
});
