import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { blockingRoutes } from '../../routes/blocking.js';

vi.mock('../../lib/mssql.js', () => ({
  getSharedPool: vi.fn(),
}));

import { getSharedPool } from '../../lib/mssql.js';
const mockedGetSharedPool = vi.mocked(getSharedPool);

function createMockPool() {
  return { query: vi.fn() };
}

const mockConfig = {
  encryptionKey: 'test-key-32-chars-long-xxxxxxxx',
  apiPort: 3001,
  pgHost: 'localhost',
  pgPort: 5432,
  pgUser: 'test',
  pgPassword: 'test',
  pgDatabase: 'test',
  collectorIntervalMs: 30000,
};

describe('blocking routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await blockingRoutes(app, mockPool as never, mockConfig as never);
    await app.ready();
  });

  // --- GET /api/metrics/:id/blocking ---
  it('GET /api/metrics/:id/blocking returns blocking events for instance', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          event_time: '2026-03-28T10:00:00Z',
          head_blocker_spid: 60,
          head_blocker_login: 'admin',
          head_blocker_host: 'APP01',
          head_blocker_app: 'AdminTool',
          head_blocker_db: 'Sales',
          head_blocker_sql: 'UPDATE x',
          chain_json: [{ spid: 60, blocked_by: null }, { spid: 55, blocked_by: 60 }],
          total_blocked_count: 1,
          max_wait_time_ms: 15000,
          collected_at: '2026-03-28T10:00:01Z',
        },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/blocking' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].head_blocker_spid).toBe(60);
    expect(body[0].chain_json).toHaveLength(2);
  });

  it('GET /api/metrics/:id/blocking respects range param', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({ method: 'GET', url: '/api/metrics/1/blocking?range=24h' });

    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[1]).toContain('24 hours');
  });

  it('GET /api/metrics/:id/blocking defaults to 1 hour range', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({ method: 'GET', url: '/api/metrics/1/blocking' });

    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[1]).toContain('1 hour');
  });

  it('GET /api/metrics/:id/blocking supports from/to params', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({
      method: 'GET',
      url: '/api/metrics/1/blocking?from=2026-03-28T00:00:00Z&to=2026-03-28T12:00:00Z',
    });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('collected_at >= $2');
    expect(sql).toContain('collected_at <= $3');
  });

  // --- GET /api/blocking/recent ---
  it('GET /api/blocking/recent returns fleet-wide recent blocking events', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, instance_id: 1, instance_name: 'SQLPROD01', event_time: '2026-03-28T10:00:00Z', head_blocker_spid: 60, head_blocker_login: 'admin', total_blocked_count: 2, max_wait_time_ms: 30000, collected_at: '2026-03-28T10:00:01Z' },
        { id: 2, instance_id: 2, instance_name: 'SQLPROD02', event_time: '2026-03-28T10:01:00Z', head_blocker_spid: 75, head_blocker_login: 'svc_account', total_blocked_count: 1, max_wait_time_ms: 10000, collected_at: '2026-03-28T10:01:01Z' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/blocking/recent' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(2);
  });

  // --- GET /api/blocking/counts ---
  it('GET /api/blocking/counts returns per-instance counts', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { instance_id: 1, count: 5 },
        { instance_id: 2, count: 2 },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/blocking/counts' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body[1]).toBe(5);
    expect(body[2]).toBe(2);
  });

  it('GET /api/blocking/counts returns empty object when no events', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/blocking/counts' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({});
  });

  // --- GET /api/metrics/:id/blocking/config ---
  it('GET /api/metrics/:id/blocking/config returns blocked process threshold', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 1, host: 'sql01', port: 1433, auth_type: 'sql', encrypted_credentials: Buffer.from('enc') }],
    });

    const mockSqlRequest = {
      query: vi.fn().mockResolvedValueOnce({
        recordset: [{ blocked_process_threshold: 5 }],
      }),
    };
    const mockSqlPool = { request: () => mockSqlRequest };
    mockedGetSharedPool.mockResolvedValueOnce(mockSqlPool as never);

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/blocking/config' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.blocked_process_threshold).toBe(5);
  });

  it('GET /api/metrics/:id/blocking/config returns 0 when threshold disabled', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 1, host: 'sql01', port: 1433, auth_type: 'sql', encrypted_credentials: Buffer.from('enc') }],
    });

    const mockSqlRequest = {
      query: vi.fn().mockResolvedValueOnce({
        recordset: [{ blocked_process_threshold: 0 }],
      }),
    };
    const mockSqlPool = { request: () => mockSqlRequest };
    mockedGetSharedPool.mockResolvedValueOnce(mockSqlPool as never);

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/blocking/config' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).blocked_process_threshold).toBe(0);
  });

  it('GET /api/metrics/:id/blocking/config returns 404 for unknown instance', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/999/blocking/config' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/metrics/:id/blocking/config returns 502 on SQL Server connection error', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 1, host: 'sql01', port: 1433, auth_type: 'sql', encrypted_credentials: Buffer.from('enc') }],
    });

    mockedGetSharedPool.mockRejectedValueOnce(new Error('Connection refused'));

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/blocking/config' });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toContain('Connection refused');
  });
});
