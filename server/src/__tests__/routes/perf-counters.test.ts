import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { metricRoutes } from '../../routes/metrics.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('perf-counters endpoint', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await metricRoutes(app, mockPool as never);
    await app.ready();
  });

  it('GET /perf-counters returns latest values and time series', async () => {
    // Latest values query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { counter_name: 'Batch Requests/sec', cntr_value: '150', collected_at: '2026-03-22T10:00:00Z' },
        { counter_name: 'User Connections', cntr_value: '42', collected_at: '2026-03-22T10:00:00Z' },
      ],
    });
    // Time series query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { bucket: '2026-03-22T09:58:00Z', counter_name: 'Batch Requests/sec', cntr_value: 120 },
        { bucket: '2026-03-22T09:59:00Z', counter_name: 'Batch Requests/sec', cntr_value: 150 },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/perf-counters?range=1h' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.latest).toHaveLength(2);
    expect(body.latest[0].counter_name).toBe('Batch Requests/sec');
    expect(body.latest[0].cntr_value).toBe(150);
    expect(body.series).toHaveLength(2);
  });

  it('GET /perf-counters with from/to uses custom time range', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics/1/perf-counters?from=2026-03-22T08:00:00Z&to=2026-03-22T10:00:00Z',
    });
    expect(res.statusCode).toBe(200);
    expect(mockPool.query.mock.calls[0][0]).toContain('collected_at >= $2');
  });

  it('GET /perf-counters returns empty arrays when no data', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/perf-counters?range=1h' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.latest).toEqual([]);
    expect(body.series).toEqual([]);
  });
});
