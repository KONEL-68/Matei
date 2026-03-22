import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { metricRoutes } from '../../routes/metrics.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('session history routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await metricRoutes(app, mockPool as never);
    await app.ready();
  });

  // --- sessions/history ---
  it('GET /sessions/history returns distinct timestamps', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { collected_at: '2026-03-22T10:01:00Z' },
        { collected_at: '2026-03-22T10:00:30Z' },
        { collected_at: '2026-03-22T10:00:00Z' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/sessions/history?range=1h' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(3);
    expect(body[0]).toBe('2026-03-22T10:01:00Z');
  });

  it('GET /sessions/history returns empty array when no data', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/sessions/history?range=1h' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  // --- sessions?at= ---
  it('GET /sessions?at= snaps to closest snapshot before given time', async () => {
    // First query: find closest snapshot
    mockPool.query.mockResolvedValueOnce({
      rows: [{ collected_at: '2026-03-22T10:00:30Z' }],
    });
    // Second query: fetch sessions at that time
    mockPool.query.mockResolvedValueOnce({
      rows: [{ session_id: 55, collected_at: '2026-03-22T10:00:30Z' }],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics/1/sessions?at=2026-03-22T10:00:45Z',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].session_id).toBe(55);
  });

  it('GET /sessions?at= returns empty when no snapshot before given time', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics/1/sessions?at=2020-01-01T00:00:00Z',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  // --- sessions (latest) ---
  it('GET /sessions without ?at returns latest snapshot', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ latest: '2026-03-22T10:01:00Z' }] });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ session_id: 60, collected_at: '2026-03-22T10:01:00Z' }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/sessions' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body[0].session_id).toBe(60);
  });
});
