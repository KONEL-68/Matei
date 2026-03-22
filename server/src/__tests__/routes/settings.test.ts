import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { settingsRoutes } from '../../routes/settings.js';

describe('settings routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    // settings routes don't use pool currently, pass a dummy
    await settingsRoutes(app, {} as never);
    await app.ready();
  });

  it('GET /api/settings returns expected structure', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('retention');
    expect(body).toHaveProperty('alertThresholds');
    expect(body).toHaveProperty('collector');
  });

  it('retention values match documented policy', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    const { retention } = JSON.parse(res.body);

    expect(retention.raw_days).toBe(7);
    expect(retention.aggregate_5min_days).toBe(30);
    expect(retention.aggregate_hourly_days).toBe(365);
  });

  it('alert thresholds match engine.ts values', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    const { alertThresholds } = JSON.parse(res.body);

    expect(alertThresholds.cpu_warning.threshold).toBe(75);
    expect(alertThresholds.cpu_critical.threshold).toBe(90);
    expect(alertThresholds.memory_critical.available_mb).toBe(512);
    expect(alertThresholds.disk_warning.used_pct).toBe(90);
    expect(alertThresholds.disk_critical.used_pct).toBe(95);
    expect(alertThresholds.io_warning.latency_ms).toBe(20);
    expect(alertThresholds.io_critical.latency_ms).toBe(50);
    expect(alertThresholds.blocking_warning.seconds).toBe(60);
    expect(alertThresholds.blocking_critical.seconds).toBe(300);
    expect(alertThresholds.unreachable.cycles).toBe(3);
  });
});
