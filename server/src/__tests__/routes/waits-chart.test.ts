import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { metricRoutes, chartBucketMinutes } from '../../routes/metrics.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('waits chart', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await metricRoutes(app, mockPool as never);
    await app.ready();
  });

  it('returns empty array when no top wait types', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/waits/chart?range=1h' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('returns time-bucketed wait data for top types', async () => {
    // Step 1: top types query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { wait_type: 'CXPACKET', total: 5000 },
        { wait_type: 'LCK_M_X', total: 3000 },
      ],
    });
    // Step 2: time series query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { bucket: '2026-03-22T10:00:00Z', wait_type: 'CXPACKET', wait_ms_per_sec: 12.5 },
        { bucket: '2026-03-22T10:00:00Z', wait_type: 'LCK_M_X', wait_ms_per_sec: 5.0 },
        { bucket: '2026-03-22T10:01:00Z', wait_type: 'CXPACKET', wait_ms_per_sec: 8.0 },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/waits/chart?range=1h' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(3);
    expect(body[0].wait_type).toBe('CXPACKET');
    expect(body[0].wait_ms_per_sec).toBe(12.5);
  });
});

describe('chartBucketMinutes', () => {
  it('returns 1 for 1h and 6h ranges', () => {
    expect(chartBucketMinutes('1h')).toBe(1);
    expect(chartBucketMinutes('6h')).toBe(1);
  });

  it('returns 5 for 24h range', () => {
    expect(chartBucketMinutes('24h')).toBe(5);
  });

  it('returns 30 for 7d range', () => {
    expect(chartBucketMinutes('7d')).toBe(30);
  });
});
