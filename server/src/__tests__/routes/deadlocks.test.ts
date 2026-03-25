import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { deadlockRoutes } from '../../routes/deadlocks.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('deadlock routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await deadlockRoutes(app, mockPool as never);
    await app.ready();
  });

  // --- GET /api/metrics/:id/deadlocks ---
  it('GET /api/metrics/:id/deadlocks returns deadlocks for instance', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, deadlock_time: '2026-03-25T10:00:00Z', victim_spid: 55, victim_query: 'SELECT 1', collected_at: '2026-03-25T10:00:01Z' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/deadlocks' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].victim_spid).toBe(55);
  });

  it('GET /api/metrics/:id/deadlocks respects range param', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({ method: 'GET', url: '/api/metrics/1/deadlocks?range=24h' });

    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[1]).toContain('24 hours');
  });

  it('GET /api/metrics/:id/deadlocks defaults to 1 hour range', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({ method: 'GET', url: '/api/metrics/1/deadlocks' });

    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[1]).toContain('1 hour');
  });

  // --- GET /api/deadlocks/:deadlockId ---
  it('GET /api/deadlocks/:deadlockId returns single deadlock with XML', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 42, instance_id: 1, deadlock_time: '2026-03-25T10:00:00Z', victim_spid: 55, victim_query: 'SELECT 1', deadlock_xml: '<deadlock/>', collected_at: '2026-03-25T10:00:01Z' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/deadlocks/42' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(42);
    expect(body.deadlock_xml).toBe('<deadlock/>');
  });

  it('GET /api/deadlocks/:deadlockId returns 404 when not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/deadlocks/999' });
    expect(res.statusCode).toBe(404);
  });

  // --- GET /api/deadlocks/recent ---
  it('GET /api/deadlocks/recent returns fleet-wide recent deadlocks', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, instance_id: 1, instance_name: 'SQLPROD01', deadlock_time: '2026-03-25T10:00:00Z', victim_spid: 55, victim_query: 'SELECT 1', collected_at: '2026-03-25' },
        { id: 2, instance_id: 2, instance_name: 'SQLPROD02', deadlock_time: '2026-03-25T10:01:00Z', victim_spid: 60, victim_query: 'UPDATE t SET x=1', collected_at: '2026-03-25' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/deadlocks/recent' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(2);
  });

  // --- GET /api/deadlocks/counts ---
  it('GET /api/deadlocks/counts returns per-instance counts', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { instance_id: 1, count: 3 },
        { instance_id: 2, count: 1 },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/deadlocks/counts' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body[1]).toBe(3);
    expect(body[2]).toBe(1);
  });

  it('GET /api/deadlocks/counts returns empty object when no deadlocks', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/deadlocks/counts' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({});
  });
});
