import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { authRoutes, ensureDefaultAdmin } from '../../routes/auth.js';
import { hashPassword } from '../../lib/auth.js';

const TEST_SECRET = 'test-secret-key-for-unit-tests-only';

function createMockPool() {
  return { query: vi.fn() };
}

describe('auth routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await authRoutes(app, mockPool as never, TEST_SECRET);
    await app.ready();
  });

  // --- POST /api/auth/login ---
  it('POST /api/auth/login returns tokens on valid credentials', async () => {
    const passwordHash = await hashPassword('correct-password');
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{ id: 1, username: 'admin', password_hash: passwordHash, role: 'admin' }],
      })
      .mockResolvedValueOnce({ rows: [] }); // last_login update

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'correct-password' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user.username).toBe('admin');
    expect(body.user.role).toBe('admin');
  });

  it('POST /api/auth/login returns 401 for unknown user', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nobody', password: 'password' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('POST /api/auth/login returns 401 for wrong password', async () => {
    const passwordHash = await hashPassword('correct-password');
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 1, username: 'admin', password_hash: passwordHash, role: 'admin' }],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrong-password' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('POST /api/auth/login returns 400 when missing credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  // --- POST /api/auth/refresh ---
  it('POST /api/auth/refresh returns 400 when missing token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /api/auth/refresh returns 401 for invalid token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: 'not-a-valid-token' },
    });

    expect(res.statusCode).toBe(401);
  });

  // --- GET /api/auth/me ---
  it('GET /api/auth/me returns 401 when no user attached', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });
});

describe('ensureDefaultAdmin', () => {
  it('creates admin user when no users exist and env vars set', async () => {
    const originalUsername = process.env.ADMIN_USERNAME;
    const originalPassword = process.env.ADMIN_PASSWORD;

    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'testpass123';

    const mockPool = createMockPool();
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // no existing users
      .mockResolvedValueOnce({ rows: [] }); // insert

    await ensureDefaultAdmin(mockPool as never);

    expect(mockPool.query).toHaveBeenCalledTimes(2);
    // The second call should be the INSERT
    const insertCall = mockPool.query.mock.calls[1][0];
    expect(insertCall).toContain('INSERT INTO users');

    // Restore env
    process.env.ADMIN_USERNAME = originalUsername;
    process.env.ADMIN_PASSWORD = originalPassword;
  });

  it('skips when ADMIN_USERNAME not set', async () => {
    const originalUsername = process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_USERNAME;

    const mockPool = createMockPool();
    await ensureDefaultAdmin(mockPool as never);

    expect(mockPool.query).not.toHaveBeenCalled();

    process.env.ADMIN_USERNAME = originalUsername;
  });

  it('skips when users already exist', async () => {
    const originalUsername = process.env.ADMIN_USERNAME;
    const originalPassword = process.env.ADMIN_PASSWORD;

    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'testpass123';

    const mockPool = createMockPool();
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // existing user

    await ensureDefaultAdmin(mockPool as never);

    expect(mockPool.query).toHaveBeenCalledTimes(1); // Only the SELECT, no INSERT

    process.env.ADMIN_USERNAME = originalUsername;
    process.env.ADMIN_PASSWORD = originalPassword;
  });
});
