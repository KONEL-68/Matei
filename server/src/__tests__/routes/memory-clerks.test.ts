import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { metricRoutes } from '../../routes/metrics.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('memory-clerks endpoint', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await metricRoutes(app, mockPool as never);
    await app.ready();
  });

  it('GET /memory-clerks returns memory clerk time series', async () => {
    // Step 1: top clerk types query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { clerk_type: 'MEMORYCLERK_SQLBUFFERPOOL', avg_mb: 4096.5 },
        { clerk_type: 'CACHESTORE_SQLCP', avg_mb: 512.25 },
      ],
    });
    // Step 2: time series query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { bucket: '2026-03-27T10:00:00Z', clerk_type: 'MEMORYCLERK_SQLBUFFERPOOL', size_mb: 4096.5 },
        { bucket: '2026-03-27T10:00:00Z', clerk_type: 'CACHESTORE_SQLCP', size_mb: 512.25 },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/memory-clerks' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0].clerk_type).toBe('MEMORYCLERK_SQLBUFFERPOOL');
    expect(body[0].size_mb).toBe(4096.5);
    expect(body[1].clerk_type).toBe('CACHESTORE_SQLCP');
    expect(body[1].size_mb).toBe(512.25);
  });

  it('query filters by instance_id and uses parameterized interval', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({ method: 'GET', url: '/api/metrics/42/memory-clerks' });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('instance_id = $1');
    expect(sql).toContain('$2::interval');
    expect(sql).toContain('AVG(size_mb)');
    expect(sql).toContain('GROUP BY clerk_type');

    const params = mockPool.query.mock.calls[0][1] as string[];
    expect(params[0]).toBe('42');
    expect(params[1]).toBe('1 hour');
  });

  it('returns empty array when no data', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/memory-clerks' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual([]);
  });

  it('converts size_mb to number', async () => {
    // Step 1: top clerk types query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { clerk_type: 'MEMORYCLERK_SQLBUFFERPOOL', avg_mb: 4096.5 },
      ],
    });
    // Step 2: time series query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { bucket: '2026-03-27T10:00:00Z', clerk_type: 'MEMORYCLERK_SQLBUFFERPOOL', size_mb: '4096.5' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/memory-clerks' });
    const body = JSON.parse(res.body);
    expect(typeof body[0].size_mb).toBe('number');
    expect(body[0].size_mb).toBe(4096.5);
  });
});
