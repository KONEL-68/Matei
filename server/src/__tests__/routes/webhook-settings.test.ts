import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { settingsRoutes } from '../../routes/settings.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('webhook settings routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await settingsRoutes(app, mockPool as never);
    await app.ready();
  });

  it('GET /api/settings/webhook returns config from DB', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ value: JSON.stringify({ url: 'https://hooks.slack.com/test', enabled: true }) }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/settings/webhook' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.url).toBe('https://hooks.slack.com/test');
    expect(body.enabled).toBe(true);
  });

  it('GET /api/settings/webhook falls back to env var when no DB row', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    process.env.ALERT_WEBHOOK_URL = 'https://env-fallback.com';

    const res = await app.inject({ method: 'GET', url: '/api/settings/webhook' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.url).toBe('https://env-fallback.com');
    expect(body.enabled).toBe(true);

    delete process.env.ALERT_WEBHOOK_URL;
  });

  it('GET /api/settings/webhook returns empty when no DB and no env', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    delete process.env.ALERT_WEBHOOK_URL;

    const res = await app.inject({ method: 'GET', url: '/api/settings/webhook' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.url).toBe('');
    expect(body.enabled).toBe(false);
  });

  it('PUT /api/settings/webhook saves config', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // upsert

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/webhook',
      payload: { url: 'https://new-webhook.com', enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    // Verify the query was called with the right config
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO settings'),
      [JSON.stringify({ url: 'https://new-webhook.com', enabled: true })],
    );
  });

  it('POST /api/settings/webhook/test returns 400 when no URL configured', async () => {
    // getWebhookConfig will be called — mock it to return empty
    mockPool.query.mockResolvedValueOnce({
      rows: [{ value: JSON.stringify({ url: '', enabled: false }) }],
    });

    const res = await app.inject({ method: 'POST', url: '/api/settings/webhook/test' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('No webhook URL');
  });
});
