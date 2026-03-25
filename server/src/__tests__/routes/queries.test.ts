import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { queryRoutes } from '../../routes/queries.js';
import crypto from 'node:crypto';

const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

function createMockPool() {
  return { query: vi.fn() };
}

function createMockConfig() {
  return { encryptionKey: TEST_ENCRYPTION_KEY } as never;
}

describe('query routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await queryRoutes(app, mockPool as never, createMockConfig());
    await app.ready();
  });

  // --- GET /api/queries/:id ---
  it('GET /api/queries/:id returns top queries', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          query_hash: 'ABC123',
          statement_text: 'SELECT * FROM orders',
          database_name: 'MyDB',
          execution_count: '150',
          cpu_ms_per_sec: '12.5',
          elapsed_ms_per_sec: '20.3',
          reads_per_sec: '500',
          writes_per_sec: '10',
          avg_cpu_ms: '3.2',
          avg_elapsed_ms: '5.1',
          avg_reads: '200',
          avg_writes: '4',
          total_cpu_ms: '480',
          total_elapsed_ms: '765',
          total_reads: '30000',
          total_writes: '600',
          sample_count: '10',
          last_grant_kb: null,
          last_used_grant_kb: null,
        },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/queries/1' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].query_hash).toBe('ABC123');
    expect(body[0].execution_count).toBe(150);
    expect(body[0].cpu_ms_per_sec).toBe(12.5);
  });

  it('GET /api/queries/:id respects sort parameter', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({ method: 'GET', url: '/api/queries/1?sort=reads' });

    const callArgs = mockPool.query.mock.calls[0][0];
    expect(callArgs).toContain('reads_per_sec');
  });

  it('GET /api/queries/:id respects from/to time range', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({
      method: 'GET',
      url: '/api/queries/1?from=2026-03-25T00:00:00Z&to=2026-03-25T12:00:00Z',
    });

    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[1]).toContain('2026-03-25T00:00:00Z');
    expect(callArgs[1]).toContain('2026-03-25T12:00:00Z');
  });

  it('GET /api/queries/:id returns empty array when no data', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/queries/1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  // --- POST /api/queries/:id/tracked ---
  it('POST /api/queries/:id/tracked tracks a query', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/queries/1/tracked',
      payload: { query_hash: 'ABC123', label: 'Slow order query' },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('POST /api/queries/:id/tracked returns 400 when query_hash missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/queries/1/tracked',
      payload: { label: 'No hash' },
    });

    expect(res.statusCode).toBe(400);
  });

  // --- DELETE /api/queries/:id/tracked/:hash ---
  it('DELETE /api/queries/:id/tracked/:hash untracks a query', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

    const res = await app.inject({ method: 'DELETE', url: '/api/queries/1/tracked/ABC123' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('DELETE /api/queries/:id/tracked/:hash returns 404 when not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 0 });

    const res = await app.inject({ method: 'DELETE', url: '/api/queries/1/tracked/NOTFOUND' });
    expect(res.statusCode).toBe(404);
  });

  // --- GET /api/queries/:id/:hash ---
  it('GET /api/queries/:id/:hash returns time series for query', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { cpu_ms_per_sec: 5.0, elapsed_ms_per_sec: 8.0, reads_per_sec: 300, execution_count_delta: 10, avg_cpu_ms: 2.5, avg_reads: 150, collected_at: '2026-03-25T10:00:00Z' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/queries/1/ABC123' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].cpu_ms_per_sec).toBe(5.0);
  });
});
