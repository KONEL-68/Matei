import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { metricRoutes } from '../../routes/metrics.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('resolveTimeFilter applied to all endpoints', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await metricRoutes(app, mockPool as never);
    await app.ready();
  });

  it('GET /waits?from=&to= uses custom time range', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { wait_type: 'CXPACKET', waiting_tasks_count: '100', wait_time_ms: '5000', max_wait_time_ms: '200', signal_wait_time_ms: '100' },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics/1/waits?from=2026-03-22T08:00:00Z&to=2026-03-22T10:00:00Z',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].wait_type).toBe('CXPACKET');
    // Custom range is 2 hours = 7200s, so wait_ms_per_sec = 5000/7200
    expect(body[0].wait_ms_per_sec).toBeCloseTo(5000 / 7200, 4);

    // Verify the query used from/to params instead of interval
    const queryCall = mockPool.query.mock.calls[0];
    expect(queryCall[0]).toContain('collected_at >= $2');
    expect(queryCall[0]).toContain('collected_at <= $3');
    expect(queryCall[1]).toContain('2026-03-22T08:00:00Z');
    expect(queryCall[1]).toContain('2026-03-22T10:00:00Z');
  });

  it('GET /waits/chart?from=&to= uses custom time range', async () => {
    // Step 1: top types
    mockPool.query.mockResolvedValueOnce({
      rows: [{ wait_type: 'LCK_M_X', total: 3000 }],
    });
    // Step 2: series
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { bucket: '2026-03-22T09:00:00Z', wait_type: 'LCK_M_X', wait_ms_per_sec: 5.0 },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics/1/waits/chart?from=2026-03-22T08:00:00Z&to=2026-03-22T10:00:00Z',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);

    // Both queries should use from/to
    expect(mockPool.query.mock.calls[0][0]).toContain('collected_at >= $2');
    expect(mockPool.query.mock.calls[1][0]).toContain('collected_at >= $2');
  });

  it('GET /file-io?from=&to= (table mode) uses custom time range', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        database_name: 'DB', file_name: 'f.mdf', file_type: 'ROWS',
        total_reads: '100', total_writes: '50',
        avg_read_latency_ms: 5, avg_write_latency_ms: 2,
        total_bytes_read: '1000', total_bytes_written: '500',
      }],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics/1/file-io?from=2026-03-22T08:00:00Z&to=2026-03-22T10:00:00Z',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body[0].database_name).toBe('DB');

    expect(mockPool.query.mock.calls[0][0]).toContain('collected_at >= $2');
  });

  it('GET /file-io?from=&to=&mode=chart uses custom time range', async () => {
    // Step 1: top files
    mockPool.query.mockResolvedValueOnce({
      rows: [{ database_name: 'MyDB', file_name: 'data.mdf', total_stall: 5000 }],
    });
    // Step 2: time series
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { bucket: '2026-03-22T09:00:00Z', file_key: 'MyDB/data.mdf', avg_read_latency_ms: 15.5, avg_write_latency_ms: 3.2 },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics/1/file-io?from=2026-03-22T08:00:00Z&to=2026-03-22T10:00:00Z&mode=chart',
    });
    expect(res.statusCode).toBe(200);
    expect(mockPool.query.mock.calls[0][0]).toContain('collected_at >= $2');
    expect(mockPool.query.mock.calls[1][0]).toContain('collected_at >= $2');
  });

  it('GET /disk?from=&to= returns time series', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { bucket: '2026-03-22T09:00:00Z', volume_mount_point: 'C:\\', used_pct: 60.5 },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics/1/disk?from=2026-03-22T08:00:00Z&to=2026-03-22T10:00:00Z',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body[0].bucket).toBeDefined();
    expect(body[0].used_pct).toBe(60.5);

    expect(mockPool.query.mock.calls[0][0]).toContain('collected_at >= $2');
  });

  it('GET /sessions/history?from=&to= uses custom time range', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ collected_at: '2026-03-22T09:00:00Z' }],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics/1/sessions/history?from=2026-03-22T08:00:00Z&to=2026-03-22T10:00:00Z',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);

    expect(mockPool.query.mock.calls[0][0]).toContain('collected_at >= $2');
  });
});
