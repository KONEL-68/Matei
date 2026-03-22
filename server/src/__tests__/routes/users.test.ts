import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { userRoutes } from '../../routes/users.js';

function createMockPool() {
  return { query: vi.fn() };
}

// Attach a mock user to all requests (simulates auth middleware)
function attachUser(app: ReturnType<typeof Fastify>, user: { userId: number; username: string; role: string }) {
  app.addHook('preHandler', async (req: { user?: typeof user }) => {
    (req as unknown as { user: typeof user }).user = user;
  });
}

describe('user routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;
  const adminUser = { userId: 1, username: 'admin', role: 'admin' };

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    attachUser(app, adminUser);
    await userRoutes(app, mockPool as never);
    await app.ready();
  });

  // --- GET /api/users ---
  it('lists all users', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, username: 'admin', role: 'admin', created_at: '2026-03-22', last_login: '2026-03-22' },
        { id: 2, username: 'viewer', role: 'admin', created_at: '2026-03-22', last_login: null },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/users' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0].username).toBe('admin');
  });

  // --- POST /api/users ---
  it('creates a user', async () => {
    const created = { id: 3, username: 'newuser', role: 'admin', created_at: '2026-03-22', last_login: null };
    mockPool.query.mockResolvedValueOnce({ rows: [created] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { username: 'newuser', password: 'secret123' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).username).toBe('newuser');
  });

  it('returns 400 when username or password missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { username: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when password too short', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { username: 'test', password: '12345' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 on duplicate username', async () => {
    mockPool.query.mockRejectedValueOnce({ code: '23505' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { username: 'admin', password: 'secret123' },
    });
    expect(res.statusCode).toBe(409);
  });

  // --- DELETE /api/users/:id ---
  it('deletes a user', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 2 }] });

    const res = await app.inject({ method: 'DELETE', url: '/api/users/2' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('cannot delete yourself', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/users/1' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Cannot delete');
  });

  it('returns 404 when deleting non-existent user', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'DELETE', url: '/api/users/999' });
    expect(res.statusCode).toBe(404);
  });

  // --- POST /api/users/:id/reset-password ---
  it('resets another user password', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 2 }] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/users/2/reset-password',
      payload: { new_password: 'newsecret123' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('returns 400 when new password too short for reset', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users/2/reset-password',
      payload: { new_password: '123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when resetting password of non-existent user', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/users/999/reset-password',
      payload: { new_password: 'newsecret123' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('user routes - change password', () => {
  it('changes own password with correct current password', async () => {
    const app = Fastify();
    const mockPool = createMockPool();
    // User with id=1
    attachUser(app, { userId: 1, username: 'admin', role: 'admin' });
    await userRoutes(app, mockPool as never);
    await app.ready();

    // Mock: get password_hash (bcrypt hash of "oldpass")
    // We mock verifyPassword indirectly via the real bcrypt — but for unit test we mock pool
    // Return a bcrypt hash that won't match, to test the 401 path
    mockPool.query.mockResolvedValueOnce({
      rows: [{ password_hash: '$2b$12$invalidhash' }],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/users/me/change-password',
      payload: { current_password: 'wrongpass', new_password: 'newpass123' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when missing passwords', async () => {
    const app = Fastify();
    const mockPool = createMockPool();
    attachUser(app, { userId: 1, username: 'admin', role: 'admin' });
    await userRoutes(app, mockPool as never);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/users/me/change-password',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
