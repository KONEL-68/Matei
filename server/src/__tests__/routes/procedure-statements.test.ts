import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// Mock mssql module
const mockRequest = {
  input: vi.fn().mockReturnThis(),
  query: vi.fn(),
};
const mockSqlPool = {
  request: vi.fn(() => mockRequest),
  close: vi.fn().mockResolvedValue(undefined),
};
vi.mock('mssql', () => {
  return {
    default: {
      ConnectionPool: vi.fn(() => ({
        connect: vi.fn().mockResolvedValue(mockSqlPool),
      })),
      NVarChar: 'NVarChar',
    },
  };
});

// Mock buildConnectionConfig to avoid crypto/decryption
vi.mock('../../lib/mssql.js', () => ({
  buildConnectionConfig: vi.fn(() => ({
    server: 'localhost',
    port: 1433,
    options: { encrypt: true, trustServerCertificate: true },
  })),
}));

import { queryRoutes } from '../../routes/queries.js';

function createMockPool() {
  return { query: vi.fn() };
}

const mockConfig = { encryptionKey: 'test-key-32-chars-long-1234567890' } as any;

describe('GET /api/queries/:id/procedure-statements', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    mockPool = createMockPool();
    await queryRoutes(app, mockPool as never, mockConfig);
    await app.ready();
  });

  it('returns 400 when db param is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/queries/1/procedure-statements?proc=dbo.MyProc',
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('db');
  });

  it('returns 400 when proc param is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/queries/1/procedure-statements?db=MyDb',
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('proc');
  });

  it('returns 400 when both params are missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/queries/1/procedure-statements',
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when instance not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/api/queries/999/procedure-statements?db=MyDb&proc=dbo.MyProc',
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Instance not found');
  });

  it('returns statement data for a valid request', async () => {
    // Mock instance lookup from PostgreSQL
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        host: 'localhost',
        port: 1433,
        auth_type: 'sql',
        encrypted_credentials: Buffer.from('test'),
      }],
    });

    // Mock the SQL Server query result
    mockRequest.query.mockResolvedValueOnce({
      recordset: [
        {
          statement_text: 'SELECT * FROM Orders WHERE CustomerID = @p1',
          execution_count: 1500,
          total_cpu_ms: 45000,
          total_elapsed_ms: 62000,
          physical_reads: 3200,
          logical_reads: 85000,
          logical_writes: 150,
          avg_cpu_ms: 30.0,
          avg_elapsed_ms: 41.3,
          last_execution_time: '2026-03-25T10:00:00.000Z',
          min_grant_kb: 512,
          last_grant_kb: 1024,
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/queries/1/procedure-statements?db=MyDb&proc=dbo.MyProc',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].statement_text).toBe('SELECT * FROM Orders WHERE CustomerID = @p1');
    expect(body[0].execution_count).toBe(1500);
    expect(body[0].total_cpu_ms).toBe(45000);
    expect(body[0].physical_reads).toBe(3200);

    // Verify parameterized inputs were used (not string concatenation)
    // qualifiedName is 3-part: "DbName.schema.ProcName" for cross-database OBJECT_ID resolution
    expect(mockRequest.input).toHaveBeenCalledWith('qualifiedName', 'NVarChar', 'MyDb.dbo.MyProc');
    expect(mockRequest.input).toHaveBeenCalledWith('dbName', 'NVarChar', 'MyDb');
  });

  it('returns 500 and cleans up connection on SQL Server error', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        host: 'localhost',
        port: 1433,
        auth_type: 'sql',
        encrypted_credentials: Buffer.from('test'),
      }],
    });

    mockRequest.query.mockRejectedValueOnce(new Error('Connection timeout'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/queries/1/procedure-statements?db=MyDb&proc=dbo.MyProc',
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Connection timeout');

    // Verify connection was closed in finally block
    expect(mockSqlPool.close).toHaveBeenCalled();
  });
});
