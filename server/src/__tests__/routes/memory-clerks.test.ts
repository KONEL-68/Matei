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

  it('GET /memory-clerks returns latest memory clerk snapshot', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { clerk_type: 'MEMORYCLERK_SQLBUFFERPOOL', size_mb: 4096.5, collected_at: '2026-03-27T10:00:00Z' },
        { clerk_type: 'CACHESTORE_SQLCP', size_mb: 512.25, collected_at: '2026-03-27T10:00:00Z' },
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

  it('query filters by instance_id and recent collected_at', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({ method: 'GET', url: '/api/metrics/42/memory-clerks' });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('instance_id = $1');
    expect(sql).toContain("INTERVAL '5 minutes'");
    expect(sql).toContain('DISTINCT ON (clerk_type)');

    const params = mockPool.query.mock.calls[0][1] as string[];
    expect(params[0]).toBe('42');
  });

  it('returns empty array when no data', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/memory-clerks' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual([]);
  });

  it('converts size_mb to number', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { clerk_type: 'MEMORYCLERK_SQLBUFFERPOOL', size_mb: '4096.5', collected_at: '2026-03-27T10:00:00Z' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/memory-clerks' });
    const body = JSON.parse(res.body);
    expect(typeof body[0].size_mb).toBe('number');
    expect(body[0].size_mb).toBe(4096.5);
  });
});
