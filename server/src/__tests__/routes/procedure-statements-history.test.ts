import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import crypto from 'node:crypto';

// Mock mssql module (needed by queries.ts even though this endpoint doesn't use it)
vi.mock('mssql', () => ({
  default: { NVarChar: 'NVarChar' },
}));

vi.mock('../../lib/mssql.js', () => ({
  getSharedPool: vi.fn(),
  closeSharedPool: vi.fn(),
}));

import { queryRoutes } from '../../routes/queries.js';

const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

function createMockPool() {
  return { query: vi.fn() };
}

function createMockConfig() {
  return { encryptionKey: TEST_ENCRYPTION_KEY } as never;
}

describe('GET /api/queries/:id/procedure-statements-history', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    mockPool = createMockPool();
    await queryRoutes(app, mockPool as never, createMockConfig());
    await app.ready();
  });

  it('returns 400 when db param is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/queries/1/procedure-statements-history?proc=dbo.MyProc&from=2026-03-25T00:00:00Z&to=2026-03-25T12:00:00Z',
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('db');
  });

  it('returns 400 when proc param is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/queries/1/procedure-statements-history?db=MyDb&from=2026-03-25T00:00:00Z&to=2026-03-25T12:00:00Z',
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('proc');
  });

  it('returns 400 when from param is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/queries/1/procedure-statements-history?db=MyDb&proc=dbo.MyProc&to=2026-03-25T12:00:00Z',
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('from');
  });

  it('returns 400 when to param is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/queries/1/procedure-statements-history?db=MyDb&proc=dbo.MyProc&from=2026-03-25T00:00:00Z',
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('to');
  });

  it('returns aggregated statement data for a valid request', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          statement_start_offset: 0,
          statement_text: 'SELECT * FROM Orders WHERE CustomerID = @p1',
          execution_count: '1500',
          total_cpu_ms: '45000',
          total_elapsed_ms: '62000',
          physical_reads: '3200',
          logical_reads: '85000',
          logical_writes: '150',
          avg_cpu_ms: '30.0',
          avg_elapsed_ms: '41.3',
          min_grant_kb: '512',
          last_grant_kb: '1024',
        },
        {
          statement_start_offset: 128,
          statement_text: 'INSERT INTO OrderLog VALUES(@id)',
          execution_count: '1500',
          total_cpu_ms: '500',
          total_elapsed_ms: '800',
          physical_reads: '10',
          logical_reads: '300',
          logical_writes: '150',
          avg_cpu_ms: '3.3',
          avg_elapsed_ms: '5.3',
          min_grant_kb: null,
          last_grant_kb: null,
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/queries/1/procedure-statements-history?db=MyDb&proc=dbo.MyProc&from=2026-03-25T00:00:00Z&to=2026-03-25T12:00:00Z',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);

    // First statement
    expect(body[0].statement_start_offset).toBe(0);
    expect(body[0].statement_text).toBe('SELECT * FROM Orders WHERE CustomerID = @p1');
    expect(body[0].execution_count).toBe(1500);
    expect(body[0].total_cpu_ms).toBe(45000);
    expect(body[0].total_elapsed_ms).toBe(62000);
    expect(body[0].physical_reads).toBe(3200);
    expect(body[0].logical_reads).toBe(85000);
    expect(body[0].logical_writes).toBe(150);
    expect(body[0].avg_cpu_ms).toBe(30.0);
    expect(body[0].avg_elapsed_ms).toBe(41.3);
    expect(body[0].min_grant_kb).toBe(512);
    expect(body[0].last_grant_kb).toBe(1024);

    // Second statement — null memory grants
    expect(body[1].statement_start_offset).toBe(128);
    expect(body[1].min_grant_kb).toBeNull();
    expect(body[1].last_grant_kb).toBeNull();
  });

  it('passes correct parameterized query with all 5 params', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({
      method: 'GET',
      url: '/api/queries/42/procedure-statements-history?db=SalesDB&proc=dbo.usp_GetOrders&from=2026-03-24T00:00:00Z&to=2026-03-25T00:00:00Z',
    });

    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const callArgs = mockPool.query.mock.calls[0];

    // Verify parameterized SQL (no string concatenation)
    expect(callArgs[0]).toContain('$1');
    expect(callArgs[0]).toContain('$2');
    expect(callArgs[0]).toContain('$3');
    expect(callArgs[0]).toContain('$4');
    expect(callArgs[0]).toContain('$5');

    // Verify parameter values
    expect(callArgs[1]).toEqual([
      '42',
      'SalesDB',
      'dbo.usp_GetOrders',
      '2026-03-24T00:00:00Z',
      '2026-03-25T00:00:00Z',
    ]);
  });

  it('returns empty array when no data found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/api/queries/1/procedure-statements-history?db=MyDb&proc=dbo.MyProc&from=2026-03-25T00:00:00Z&to=2026-03-25T12:00:00Z',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('groups results by statement_start_offset and statement_text', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({
      method: 'GET',
      url: '/api/queries/1/procedure-statements-history?db=MyDb&proc=dbo.MyProc&from=2026-03-25T00:00:00Z&to=2026-03-25T12:00:00Z',
    });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('GROUP BY statement_start_offset, statement_text');
    expect(sql).toContain('ORDER BY statement_start_offset ASC');
  });
});
