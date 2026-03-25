import { describe, it, expect, vi } from 'vitest';
import { collectInstanceHealth, type InstanceHealthRow } from '../../collector/collectors/instance-health.js';

function createMockRequest(recordset: Partial<InstanceHealthRow>[]) {
  return {
    query: vi.fn().mockResolvedValue({ recordset }),
  } as never;
}

describe('collectInstanceHealth', () => {
  it('returns instance health data', async () => {
    const rows: Partial<InstanceHealthRow>[] = [
      {
        instance_name: 'SQLPROD01',
        edition: 'Enterprise Edition (64-bit)',
        version: '16.0.4003.1',
        sp_level: 'RTM',
        major_version: 16,
        hadr_enabled: false,
        is_clustered: false,
        sqlserver_start_time: new Date('2026-03-01T08:00:00Z'),
        uptime_seconds: 2073600,
        cpu_count: 8,
        hyperthread_ratio: 2,
        physical_memory_mb: 32768,
        committed_mb: 24576,
        target_mb: 28672,
        max_workers_count: 512,
        scheduler_count: 8,
        collected_at_utc: new Date(),
      },
    ];

    const request = createMockRequest(rows);
    const result = await collectInstanceHealth(request);

    expect(result).toHaveLength(1);
    expect(result[0].instance_name).toBe('SQLPROD01');
    expect(result[0].edition).toContain('Enterprise');
    expect(result[0].cpu_count).toBe(8);
    expect(result[0].physical_memory_mb).toBe(32768);
  });

  it('returns empty array when query returns no rows', async () => {
    const request = createMockRequest([]);
    const result = await collectInstanceHealth(request);
    expect(result).toEqual([]);
  });

  it('propagates query errors', async () => {
    const request = {
      query: vi.fn().mockRejectedValue(new Error('VIEW SERVER STATE required')),
    } as never;

    await expect(collectInstanceHealth(request)).rejects.toThrow('VIEW SERVER STATE required');
  });
});
