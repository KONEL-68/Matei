import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { metricRoutes } from '../../routes/metrics.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('GET /api/metrics/:id/server-config', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await metricRoutes(app, mockPool as never);
    await app.ready();
  });

  it('returns server config for an instance', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          server_collation: 'SQL_Latin1_General_CP1_CI_AS',
          xp_cmdshell: 0,
          clr_enabled: 1,
          external_scripts_enabled: 0,
          remote_access: 1,
          max_degree_of_parallelism: 8,
          max_server_memory_mb: 32768,
          cost_threshold_for_parallelism: 50,
          collected_at: '2026-03-25T10:00:00.000Z',
        },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/server-config' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.server_collation).toBe('SQL_Latin1_General_CP1_CI_AS');
    expect(body.max_degree_of_parallelism).toBe(8);
    expect(body.max_server_memory_mb).toBe(32768);
    expect(body.cost_threshold_for_parallelism).toBe(50);
    expect(body.clr_enabled).toBe(1);
  });

  it('returns null when no config collected yet', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/server-config' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toBeNull();
  });
});
