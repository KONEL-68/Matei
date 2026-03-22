import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { metricRoutes } from '../../routes/metrics.js';

function createMockPool() {
  return { query: vi.fn() };
}

describe('metric instance routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    app = Fastify();
    mockPool = createMockPool();
    await metricRoutes(app, mockPool as never);
    await app.ready();
  });

  // --- host-info ---
  it('GET /api/metrics/:id/host-info returns host info', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        host_platform: 'Linux',
        host_distribution: 'Ubuntu 22.04',
        host_release: '5.15.0',
        host_service_pack_level: '',
        host_sku: 0,
        os_language_version: 1033,
        collected_at: '2026-03-22T00:00:00Z',
      }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/host-info' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.host_platform).toBe('Linux');
    expect(body.host_distribution).toBe('Ubuntu 22.04');
  });

  it('GET /api/metrics/:id/host-info returns null when no data', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/host-info' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toBeNull();
  });

  // --- disk ---
  it('GET /api/metrics/:id/disk returns disk volumes', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { volume_mount_point: 'C:\\', logical_volume_name: 'OS', file_system_type: 'NTFS', total_mb: 512000, available_mb: 200000, used_mb: 312000, used_pct: 60.9, collected_at: '2026-03-22' },
        { volume_mount_point: 'D:\\', logical_volume_name: 'Data', file_system_type: 'NTFS', total_mb: 1024000, available_mb: 100000, used_mb: 924000, used_pct: 90.2, collected_at: '2026-03-22' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/disk' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0].volume_mount_point).toBe('C:\\');
    expect(body[1].used_pct).toBe(90.2);
  });

  it('GET /api/metrics/:id/disk returns empty array when no data', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/disk' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  // --- file-io ---
  it('GET /api/metrics/:id/file-io returns file IO stats', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        database_name: 'MyDB',
        file_name: 'MyDB.mdf',
        file_type: 'ROWS',
        total_reads: '5000',
        total_writes: '1000',
        avg_read_latency_ms: 12.5,
        avg_write_latency_ms: 3.2,
        total_bytes_read: '1048576000',
        total_bytes_written: '524288000',
      }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/file-io?range=1h' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].database_name).toBe('MyDB');
    expect(body[0].total_reads).toBe(5000);
    expect(body[0].avg_read_latency_ms).toBe(12.5);
  });

  it('GET /api/metrics/:id/file-io handles divide-by-zero (no reads)', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        database_name: 'EmptyDB',
        file_name: 'empty.mdf',
        file_type: 'ROWS',
        total_reads: '0',
        total_writes: '0',
        avg_read_latency_ms: 0,
        avg_write_latency_ms: 0,
        total_bytes_read: '0',
        total_bytes_written: '0',
      }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/file-io' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body[0].avg_read_latency_ms).toBe(0);
    expect(body[0].avg_write_latency_ms).toBe(0);
  });

  // --- blocking-chains ---
  it('GET /api/metrics/:id/blocking-chains returns empty when no sessions', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ latest: null }] });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/blocking-chains' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('GET /api/metrics/:id/blocking-chains builds tree from sessions', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ latest: '2026-03-22T00:00:00Z' }] });
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { session_id: 55, blocking_session_id: null, login_name: 'admin', database_name: 'DB1', wait_type: null, wait_time_ms: null, elapsed_time_ms: 5000, current_statement: 'UPDATE t' },
        { session_id: 60, blocking_session_id: 55, login_name: 'app', database_name: 'DB1', wait_type: 'LCK_M_X', wait_time_ms: 3000, elapsed_time_ms: 3000, current_statement: 'SELECT' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/metrics/1/blocking-chains' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].session_id).toBe(55);
    expect(body[0].children).toHaveLength(1);
  });
});
