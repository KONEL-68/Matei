import { describe, it, expect, vi } from 'vitest';
import { collectOsDisk, type OsDiskRow } from '../../collector/collectors/os-disk.js';

function createMockRequest(recordset: Partial<OsDiskRow>[]) {
  return {
    query: vi.fn().mockResolvedValue({ recordset }),
  } as never;
}

describe('collectOsDisk', () => {
  it('returns disk volume stats', async () => {
    const rows: Partial<OsDiskRow>[] = [
      {
        volume_mount_point: 'C:\\',
        logical_volume_name: 'OS',
        file_system_type: 'NTFS',
        total_mb: 102400,
        available_mb: 30000,
        used_mb: 72400,
        used_pct: 70.7,
        supports_compression: true,
        is_compressed: false,
        collected_at_utc: new Date(),
      },
      {
        volume_mount_point: 'D:\\',
        logical_volume_name: 'Data',
        file_system_type: 'NTFS',
        total_mb: 512000,
        available_mb: 200000,
        used_mb: 312000,
        used_pct: 60.94,
        supports_compression: true,
        is_compressed: false,
        collected_at_utc: new Date(),
      },
    ];

    const request = createMockRequest(rows);
    const result = await collectOsDisk(request);

    expect(result).toHaveLength(2);
    expect(result[0].volume_mount_point).toBe('C:\\');
    expect(result[0].total_mb).toBe(102400);
    expect(result[0].used_pct).toBe(70.7);
    expect(result[1].volume_mount_point).toBe('D:\\');
  });

  it('returns empty array when no volumes found', async () => {
    const request = createMockRequest([]);
    const result = await collectOsDisk(request);
    expect(result).toEqual([]);
  });

  it('propagates query errors', async () => {
    const request = {
      query: vi.fn().mockRejectedValue(new Error('Permission denied')),
    } as never;

    await expect(collectOsDisk(request)).rejects.toThrow('Permission denied');
  });
});
