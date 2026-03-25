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

describe('procedure-stats API routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await queryRoutes(app, mockPool as never, createMockConfig());
    await app.ready();
  });

  it('GET /api/queries/:id/procedure-stats returns aggregated procedure stats', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          database_name: 'MyDB',
          procedure_name: 'dbo.usp_GetOrders',
          execution_count: '500',
          cpu_ms_per_sec: '25.5',
          elapsed_ms_per_sec: '40.2',
          reads_per_sec: '1200',
          writes_per_sec: '50',
          avg_cpu_ms: '5.1',
          avg_elapsed_ms: '8.04',
          avg_reads: '240',
          avg_writes: '10',
          total_cpu_ms: '2550',
          total_elapsed_ms: '4020',
          total_reads: '120000',
          total_writes: '5000',
          sample_count: '20',
        },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/queries/1/procedure-stats' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].procedure_name).toBe('dbo.usp_GetOrders');
    expect(body[0].execution_count).toBe(500);
    expect(body[0].cpu_ms_per_sec).toBe(25.5);
    expect(body[0].total_cpu_ms).toBe(2550);
    expect(body[0].sample_count).toBe(20);
  });

  it('GET /api/queries/:id/procedure-stats respects from/to time range', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({
      method: 'GET',
      url: '/api/queries/1/procedure-stats?from=2026-03-25T00:00:00Z&to=2026-03-25T12:00:00Z',
    });

    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[1]).toContain('2026-03-25T00:00:00Z');
    expect(callArgs[1]).toContain('2026-03-25T12:00:00Z');
  });

  it('GET /api/queries/:id/procedure-stats respects sort parameter', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({ method: 'GET', url: '/api/queries/1/procedure-stats?sort=reads' });

    const callArgs = mockPool.query.mock.calls[0][0];
    expect(callArgs).toContain('reads_per_sec');
  });

  it('GET /api/queries/:id/procedure-stats returns empty array when no data', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/queries/1/procedure-stats' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('GET /api/queries/:id/procedure-stats respects limit parameter', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({ method: 'GET', url: '/api/queries/1/procedure-stats?limit=10' });

    const callArgs = mockPool.query.mock.calls[0];
    // limit should be in the params array
    expect(callArgs[1]).toContain(10);
  });

  it('GET /api/queries/:id/procedure-stats caps limit at 200', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({ method: 'GET', url: '/api/queries/1/procedure-stats?limit=500' });

    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[1]).toContain(200);
  });
});
