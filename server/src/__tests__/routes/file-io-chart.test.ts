import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { metricRoutes } from '../../routes/metrics.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('file-io chart mode', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await metricRoutes(app, mockPool as never);
    await app.ready();
  });

  it('returns empty when no top files', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/file-io?range=1h&mode=chart' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('returns time-bucketed latency for top files', async () => {
    // Step 1: top files
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { database_name: 'MyDB', file_name: 'data.mdf', total_stall: 5000 },
      ],
    });
    // Step 2: time series
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { bucket: '2026-03-22T10:00:00Z', file_key: 'MyDB/data.mdf', avg_read_latency_ms: 15.5, avg_write_latency_ms: 3.2 },
        { bucket: '2026-03-22T10:01:00Z', file_key: 'MyDB/data.mdf', avg_read_latency_ms: 55.0, avg_write_latency_ms: 8.1 },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/file-io?range=1h&mode=chart' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0].file_key).toBe('MyDB/data.mdf');
    expect(body[1].avg_read_latency_ms).toBe(55.0);
  });

  it('table mode still works (default)', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        database_name: 'DB', file_name: 'f.mdf', file_type: 'ROWS',
        total_reads: '100', total_writes: '50',
        avg_read_latency_ms: 5, avg_write_latency_ms: 2,
        total_bytes_read: '1000', total_bytes_written: '500',
      }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/file-io?range=1h' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body[0].database_name).toBe('DB');
  });
});
