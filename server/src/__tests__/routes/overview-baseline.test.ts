import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { metricRoutes } from '../../routes/metrics.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('GET /api/metrics/:id/overview-baseline', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await metricRoutes(app, mockPool as never);
    await app.ready();
  });

  it('returns 400 when metric param is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/overview-baseline' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('metric');
  });

  it('returns 400 for invalid metric value', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/overview-baseline?metric=bogus' });
    expect(res.statusCode).toBe(400);
  });

  it('returns baseline data for valid cpu metric', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { hour_of_day: 0, baseline_min: 5.1, baseline_avg: 15.3, baseline_max: 45.0 },
        { hour_of_day: 1, baseline_min: 3.2, baseline_avg: 12.1, baseline_max: 38.5 },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/overview-baseline?metric=cpu' });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({
      hour_of_day: 0,
      baseline_min: 5.1,
      baseline_avg: 15.3,
      baseline_max: 45.0,
    });
  });

  it('passes correct parameterized query', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await app.inject({ method: 'GET', url: '/api/metrics/42/overview-baseline?metric=waits' });

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('overview_baseline'),
      ['42', 'waits'],
    );
  });

  it('returns empty array when no baseline data exists', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/overview-baseline?metric=memory' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('handles null baseline values', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { hour_of_day: 12, baseline_min: null, baseline_avg: null, baseline_max: null },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/overview-baseline?metric=disk_io' });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body[0]).toEqual({
      hour_of_day: 12,
      baseline_min: null,
      baseline_avg: null,
      baseline_max: null,
    });
  });

  it('accepts all valid metric values', async () => {
    for (const metric of ['cpu', 'memory', 'waits', 'disk_io']) {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({ method: 'GET', url: `/api/metrics/1/overview-baseline?metric=${metric}` });
      expect(res.statusCode).toBe(200);
    }
  });
});
