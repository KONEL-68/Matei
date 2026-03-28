import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { metricRoutes } from '../../routes/metrics.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('GET /api/metrics/:id/permissions', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await metricRoutes(app, mockPool as never);
    await app.ready();
  });

  it('returns grouped role members for an instance', async () => {
    // Single query: get all rows matching the latest collected_at via subquery
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { role_name: 'sysadmin', login_name: 'sa', login_type: 'SQL login', collected_at: '2026-03-27T00:00:00.000Z' },
        { role_name: 'sysadmin', login_name: 'DOMAIN\\Admin', login_type: 'Windows login', collected_at: '2026-03-27T00:00:00.000Z' },
        { role_name: 'dbcreator', login_name: 'DOMAIN\\AppGroup', login_type: 'Active Directory account', collected_at: '2026-03-27T00:00:00.000Z' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/permissions' });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.collected_at).toBe('2026-03-27T00:00:00.000Z');
    expect(body.roles).toHaveLength(8);

    const sysadmin = body.roles.find((r: { role_name: string }) => r.role_name === 'sysadmin');
    expect(sysadmin.members).toHaveLength(2);
    expect(sysadmin.sql_logins).toBe(1);
    expect(sysadmin.windows_logins).toBe(1);

    const dbcreator = body.roles.find((r: { role_name: string }) => r.role_name === 'dbcreator');
    expect(dbcreator.members).toHaveLength(1);
    expect(dbcreator.ad_accounts).toBe(1);

    // Empty roles should still be present
    const serveradmin = body.roles.find((r: { role_name: string }) => r.role_name === 'serveradmin');
    expect(serveradmin.members).toHaveLength(0);
    expect(serveradmin.sql_logins).toBe(0);
  });

  it('returns empty roles when no data collected yet', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/permissions' });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.collected_at).toBeNull();
    expect(body.roles).toHaveLength(0);
  });
});
