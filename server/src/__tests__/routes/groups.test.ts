import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { groupRoutes } from '../../routes/groups.js';

// Mock pg.Pool
function createMockPool() {
  return {
    query: vi.fn(),
  };
}

describe('group routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await groupRoutes(app, mockPool as never);
    await app.ready();
  });

  it('GET /api/groups returns empty array when no groups', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/groups' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('GET /api/groups returns groups with instance count', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, name: 'Production', description: null, position: 0, created_at: '2026-03-22', instance_count: 5 },
        { id: 2, name: 'Staging', description: 'Test env', position: 1, created_at: '2026-03-22', instance_count: 2 },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/groups' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe('Production');
    expect(body[0].instance_count).toBe(5);
  });

  it('POST /api/groups creates a group', async () => {
    const created = { id: 1, name: 'Production', description: null, position: 0, created_at: '2026-03-22' };
    mockPool.query.mockResolvedValueOnce({ rows: [created] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/groups',
      payload: { name: 'Production' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).name).toBe('Production');
  });

  it('POST /api/groups returns 400 when name is empty', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/groups',
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/groups returns 409 on duplicate name', async () => {
    mockPool.query.mockRejectedValueOnce({ code: '23505' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/groups',
      payload: { name: 'Production' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('PUT /api/groups/:id updates a group', async () => {
    const updated = { id: 1, name: 'Prod', description: 'Updated', position: 0, created_at: '2026-03-22' };
    mockPool.query.mockResolvedValueOnce({ rows: [updated] });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/groups/1',
      payload: { name: 'Prod', description: 'Updated' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).name).toBe('Prod');
  });

  it('PUT /api/groups/:id returns 404 when not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/groups/999',
      payload: { name: 'Nope' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/groups/:id deletes a group', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const res = await app.inject({ method: 'DELETE', url: '/api/groups/1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('DELETE /api/groups/:id returns 404 when not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'DELETE', url: '/api/groups/999' });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /api/groups/:id/instances assigns instances to group', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // group exists check
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // update instances

    const res = await app.inject({
      method: 'PUT',
      url: '/api/groups/1/instances',
      payload: { instanceIds: [1, 2, 3] },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('PUT /api/groups/:id/instances returns 404 when group not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // group not found

    const res = await app.inject({
      method: 'PUT',
      url: '/api/groups/999/instances',
      payload: { instanceIds: [1] },
    });
    expect(res.statusCode).toBe(404);
  });
});
