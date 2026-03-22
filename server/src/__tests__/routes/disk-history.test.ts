import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { metricRoutes } from '../../routes/metrics.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('disk history routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await metricRoutes(app, mockPool as never);
    await app.ready();
  });

  it('GET /disk?range=6h returns time series', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { bucket: '2026-03-22T10:00:00Z', volume_mount_point: 'C:\\', used_pct: 60.5 },
        { bucket: '2026-03-22T10:05:00Z', volume_mount_point: 'C:\\', used_pct: 61.0 },
        { bucket: '2026-03-22T10:00:00Z', volume_mount_point: 'D:\\', used_pct: 92.1 },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/disk?range=6h' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(3);
    expect(body[0].bucket).toBeDefined();
    expect(body[0].volume_mount_point).toBe('C:\\');
    expect(body[0].used_pct).toBe(60.5);
  });

  it('GET /disk without range returns latest snapshot', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { volume_mount_point: 'C:\\', logical_volume_name: 'OS', file_system_type: 'NTFS', total_mb: 512000, available_mb: 200000, used_mb: 312000, used_pct: 60.9, collected_at: '2026-03-22' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/disk' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body[0].total_mb).toBe(512000);
  });

  it('GET /disk?range=1h returns latest snapshot (1h not enough for trend)', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { volume_mount_point: 'C:\\', logical_volume_name: 'OS', file_system_type: 'NTFS', total_mb: 512000, available_mb: 200000, used_mb: 312000, used_pct: 60.9, collected_at: '2026-03-22' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/disk?range=1h' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Should return snapshot format (has total_mb), not time series (has bucket)
    expect(body[0].total_mb).toBe(512000);
  });
});
