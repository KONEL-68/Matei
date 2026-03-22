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
    // Latest values query (no time filter)
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

  it('latest query has no time filter — returns data regardless of age', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { counter_name: 'User Connections', cntr_value: '10', collected_at: '2026-03-20T10:00:00Z' },
      ],
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/perf-counters?range=1h' });
    expect(res.statusCode).toBe(200);

    // Latest query should NOT contain time filter
    const latestSql = mockPool.query.mock.calls[0][0] as string;
    expect(latestSql).not.toContain('NOW()');
    expect(latestSql).not.toContain('interval');

    // Series query SHOULD contain time filter
    const seriesSql = mockPool.query.mock.calls[1][0] as string;
    expect(seriesSql).toContain('NOW()');

    const body = JSON.parse(res.body);
    expect(body.latest).toHaveLength(1);
    expect(body.latest[0].cntr_value).toBe(10);
  });

  it('GET /perf-counters with from/to uses custom time range for series only', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics/1/perf-counters?from=2026-03-22T08:00:00Z&to=2026-03-22T10:00:00Z',
    });
    expect(res.statusCode).toBe(200);
    // Series query should use from/to
    expect(mockPool.query.mock.calls[1][0]).toContain('collected_at >= $2');
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

describe('perf-counters debug endpoint', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await metricRoutes(app, mockPool as never);
    await app.ready();
  });

  it('GET /perf-counters/debug returns row count and counter names', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        total_rows: 456,
        latest_row: '2026-03-22T18:00:00Z',
        distinct_counters: ['Batch Requests/sec', 'User Connections', 'Page life expectancy'],
      }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/perf-counters/debug' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total_rows).toBe(456);
    expect(body.latest_row).toBe('2026-03-22T18:00:00Z');
    expect(body.distinct_counters).toContain('Batch Requests/sec');
    expect(body.distinct_counters).toHaveLength(3);
  });

  it('GET /perf-counters/debug returns zeros when no data', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ total_rows: 0, latest_row: null, distinct_counters: null }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/perf-counters/debug' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total_rows).toBe(0);
    expect(body.latest_row).toBeNull();
  });
});
