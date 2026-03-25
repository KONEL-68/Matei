import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { instanceRoutes } from '../../routes/instances.js';
import crypto from 'node:crypto';

const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

function createMockPool() {
  return { query: vi.fn() };
}

function createMockConfig() {
  return { encryptionKey: TEST_ENCRYPTION_KEY } as never;
}

describe('instance routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await instanceRoutes(app, mockPool as never, createMockConfig());
    await app.ready();
  });

  // --- GET /api/instances ---
  it('GET /api/instances returns all instances', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, name: 'SQLPROD01', host: 'sql01.local', port: 1433, auth_type: 'sql', status: 'online', is_enabled: true, group_name: 'Production' },
        { id: 2, name: 'SQLDEV01', host: 'sql02.local', port: 1433, auth_type: 'windows', status: 'unreachable', is_enabled: true, group_name: null },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/instances' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe('SQLPROD01');
  });

  // --- GET /api/instances/:id ---
  it('GET /api/instances/:id returns single instance', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 1, name: 'SQLPROD01', host: 'sql01.local', port: 1433, status: 'online' }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/instances/1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).name).toBe('SQLPROD01');
  });

  it('GET /api/instances/:id returns 404 when not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/instances/999' });
    expect(res.statusCode).toBe(404);
  });

  // --- POST /api/instances ---
  it('POST /api/instances creates an instance', async () => {
    const created = { id: 1, name: 'NewSQL', host: 'newsql.local', port: 1433, auth_type: 'sql', status: 'unknown', is_enabled: true };
    mockPool.query.mockResolvedValueOnce({ rows: [created] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/instances',
      payload: { name: 'NewSQL', host: 'newsql.local', username: 'sa', password: 'P@ss' },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).name).toBe('NewSQL');
  });

  it('POST /api/instances returns 400 when host is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/instances',
      payload: { name: 'NoHost', host: '' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /api/instances returns 400 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/instances',
      payload: { name: '', host: 'sql.local' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /api/instances returns 409 on duplicate name', async () => {
    mockPool.query.mockRejectedValueOnce({ code: '23505', constraint: 'instances_name_key' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/instances',
      payload: { name: 'Duplicate', host: 'sql.local' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('name');
  });

  // --- PUT /api/instances/:id ---
  it('PUT /api/instances/:id updates an instance', async () => {
    const updated = { id: 1, name: 'Updated', host: 'updated.local', port: 1433 };
    mockPool.query.mockResolvedValueOnce({ rows: [updated] });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/instances/1',
      payload: { name: 'Updated', host: 'updated.local' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).name).toBe('Updated');
  });

  it('PUT /api/instances/:id returns 404 when not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/instances/999',
      payload: { name: 'Nope', host: 'nope.local' },
    });

    expect(res.statusCode).toBe(404);
  });

  // --- DELETE /api/instances/:id ---
  it('DELETE /api/instances/:id deletes an instance', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const res = await app.inject({ method: 'DELETE', url: '/api/instances/1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('DELETE /api/instances/:id returns 404 when not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'DELETE', url: '/api/instances/999' });
    expect(res.statusCode).toBe(404);
  });
});
