import { describe, it, expect, vi } from 'vitest';
import { collectOsMemory, type OsMemoryRow } from '../../collector/collectors/os-memory.js';

function createMockRequest(recordset: Partial<OsMemoryRow>[]) {
  return {
    query: vi.fn().mockResolvedValue({ recordset }),
  } as never;
}

describe('collectOsMemory', () => {
  it('returns OS and SQL memory metrics', async () => {
    const rows: Partial<OsMemoryRow>[] = [
      {
        os_total_memory_mb: 32768,
        os_available_memory_mb: 8192,
        os_used_memory_mb: 24576,
        os_memory_used_pct: 75.0,
        os_page_file_total_mb: 40960,
        os_page_file_available_mb: 30000,
        system_memory_state_desc: 'Available physical memory is high',
        sql_physical_memory_mb: 20480,
        sql_locked_pages_mb: 0,
        sql_virtual_committed_mb: 22528,
        sql_memory_utilization_pct: 90,
        sql_memory_low_notification: false,
        sql_virtual_memory_low_notification: false,
        sql_committed_mb: 20480,
        sql_target_mb: 24576,
        collected_at_utc: new Date(),
      },
    ];

    const request = createMockRequest(rows);
    const result = await collectOsMemory(request);

    expect(result).toHaveLength(1);
    expect(result[0].os_total_memory_mb).toBe(32768);
    expect(result[0].os_available_memory_mb).toBe(8192);
    expect(result[0].os_memory_used_pct).toBe(75.0);
    expect(result[0].sql_memory_low_notification).toBe(false);
    expect(result[0].sql_committed_mb).toBe(20480);
    expect(result[0].sql_target_mb).toBe(24576);
  });

  it('returns empty array when query returns no rows', async () => {
    const request = createMockRequest([]);
    const result = await collectOsMemory(request);
    expect(result).toEqual([]);
  });

  it('propagates query errors', async () => {
    const request = {
      query: vi.fn().mockRejectedValue(new Error('Access denied')),
    } as never;

    await expect(collectOsMemory(request)).rejects.toThrow('Access denied');
  });
});
