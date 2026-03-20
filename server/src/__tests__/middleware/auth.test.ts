import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuthHook } from '../../middleware/auth.js';
import { signAccessToken } from '../../lib/auth.js';

const TEST_SECRET = 'test-secret-key-for-middleware-tests';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  registerAuthHook(app, TEST_SECRET);

  // Register test routes
  app.get('/health', async () => ({ status: 'ok' }));
  app.post('/api/auth/login', async () => ({ token: 'fake' }));
  app.post('/api/auth/refresh', async () => ({ token: 'fake' }));
  app.get('/api/instances', async () => ({ data: [] }));
  app.get('/api/metrics/overview', async () => ({ total: 0 }));

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('auth middleware', () => {
  it('request without token to protected route → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/instances',
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Authentication required');
  });

  it('request with valid token → passes through', async () => {
    const token = signAccessToken(
      { userId: 1, username: 'admin', role: 'admin' },
      TEST_SECRET,
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/instances',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('request with invalid token → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/instances',
      headers: { authorization: 'Bearer invalid-token' },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Invalid or expired token');
  });

  it('request with expired token → 401', async () => {
    const jwt = await import('jsonwebtoken');
    const token = jwt.default.sign(
      { userId: 1, username: 'admin', role: 'admin' },
      TEST_SECRET,
      { expiresIn: '0s' },
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics/overview',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('/health endpoint works without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
  });

  it('/api/auth/login works without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'test', password: 'test' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('/api/auth/refresh works without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: 'fake' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('request with Bearer prefix missing → 401', async () => {
    const token = signAccessToken(
      { userId: 1, username: 'admin', role: 'admin' },
      TEST_SECRET,
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/instances',
      headers: { authorization: token }, // Missing "Bearer " prefix
    });

    expect(res.statusCode).toBe(401);
  });
});
