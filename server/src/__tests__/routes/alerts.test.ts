import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { alertRoutes } from '../../routes/alerts.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('alert routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await alertRoutes(app, mockPool as never);
    await app.ready();
  });

  // --- GET /api/alerts ---
  it('GET /api/alerts returns alerts list', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, instance_id: 1, instance_name: 'SQLPROD01', alert_type: 'cpu', severity: 'warning', message: 'CPU > 75%', acknowledged: false, created_at: '2026-03-25' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/alerts' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].alert_type).toBe('cpu');
  });

  it('GET /api/alerts filters by severity', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/alerts?severity=critical' });
    expect(res.statusCode).toBe(200);

    // Verify the query included severity param
    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[1]).toContain('critical');
  });

  it('GET /api/alerts filters by acknowledged', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/alerts?acknowledged=false' });
    expect(res.statusCode).toBe(200);

    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[1]).toContain(false);
  });

  it('GET /api/alerts returns empty array when no alerts', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/alerts' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  // --- GET /api/alerts/count ---
  it('GET /api/alerts/count returns unacknowledged count', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ count: 5 }] });

    const res = await app.inject({ method: 'GET', url: '/api/alerts/count' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ count: 5 });
  });

  // --- POST /api/alerts/:id/acknowledge ---
  it('POST /api/alerts/:id/acknowledge acknowledges alert', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

    const res = await app.inject({ method: 'POST', url: '/api/alerts/1/acknowledge' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ id: 1, acknowledged: true });
  });

  it('POST /api/alerts/:id/acknowledge returns 404 for missing alert', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 0 });

    const res = await app.inject({ method: 'POST', url: '/api/alerts/999/acknowledge' });
    expect(res.statusCode).toBe(404);
  });
});
