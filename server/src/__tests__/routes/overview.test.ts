import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { metricRoutes } from '../../routes/metrics.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('GET /api/metrics/overview', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await metricRoutes(app, mockPool as never);
    await app.ready();
  });

  it('returns new fields: disk_io_mb_per_sec, alert_count, first_alert_message', async () => {
    // 1) instances query
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, name: 'SQL1', host: 'h1', port: 1433, status: 'online', last_seen: '2026-03-22T00:00:00Z', is_enabled: true, group_id: null, group_name: null },
      ],
    });
    // 2) cpu
    mockPool.query.mockResolvedValueOnce({ rows: [{ instance_id: 1, sql_cpu_pct: 50, other_process_cpu_pct: 10, system_idle_pct: 40 }] });
    // 3) memory
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // 4) health
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // 5) waits
    mockPool.query.mockResolvedValueOnce({ rows: [
      { instance_id: 1, wait_type: 'CXPACKET', wait_time_ms_delta: 3000 },
      { instance_id: 1, wait_type: 'ASYNC_NETWORK_IO', wait_time_ms_delta: 1500 },
    ] });
    // 6) disk io
    mockPool.query.mockResolvedValueOnce({ rows: [{ instance_id: 1, disk_io_mb_per_sec: 12.5 }] });
    // 7) alerts
    mockPool.query.mockResolvedValueOnce({ rows: [{ instance_id: 1, alert_count: 2, first_alert_message: 'CPU critical' }] });
    // 8) healthy_since
    mockPool.query.mockResolvedValueOnce({ rows: [{ instance_id: 1, last_alert_at: '2026-03-22T09:00:00Z' }] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/overview' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    const inst = body.instances[0];
    expect(inst.disk_io_mb_per_sec).toBe(12.5);
    expect(inst.alert_count).toBe(2);
    expect(inst.first_alert_message).toBe('CPU critical');
    // total_wait_ms_per_sec = (3000 + 1500) / 30 = 150
    expect(inst.total_wait_ms_per_sec).toBe(150);
  });

  it('returns defaults when no metric data exists', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, name: 'SQL1', host: 'h1', port: 1433, status: 'online', last_seen: '2026-03-22T00:00:00Z', is_enabled: true, group_id: null, group_name: null },
      ],
    });
    // All metric queries return empty
    for (let i = 0; i < 7; i++) {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
    }

    const res = await app.inject({ method: 'GET', url: '/api/metrics/overview' });
    const body = JSON.parse(res.body);
    const inst = body.instances[0];

    expect(inst.disk_io_mb_per_sec).toBeNull();
    expect(inst.alert_count).toBe(0);
    expect(inst.first_alert_message).toBeNull();
    expect(inst.total_wait_ms_per_sec).toBeNull();
    expect(inst.healthy_since).toBe('2026-03-22T00:00:00Z'); // falls back to last_seen
  });
});
