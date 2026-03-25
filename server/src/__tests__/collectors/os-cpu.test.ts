import { describe, it, expect, vi } from 'vitest';
import { collectOsCpu, type OsCpuRow } from '../../collector/collectors/os-cpu.js';

function createMockRequest(recordset: Partial<OsCpuRow>[]) {
  return {
    query: vi.fn().mockResolvedValue({ recordset }),
  } as never;
}

describe('collectOsCpu', () => {
  it('returns CPU metrics from ring buffers', async () => {
    const rows: Partial<OsCpuRow>[] = [
      {
        record_id: 12345,
        event_time_utc: new Date('2026-03-25T10:00:00Z'),
        system_idle_pct: 40,
        sql_cpu_pct: 45,
        other_process_cpu_pct: 15,
        collected_at_utc: new Date(),
      },
    ];

    const request = createMockRequest(rows);
    const result = await collectOsCpu(request);

    expect(result).toHaveLength(1);
    expect(result[0].sql_cpu_pct).toBe(45);
    expect(result[0].system_idle_pct).toBe(40);
    expect(result[0].other_process_cpu_pct).toBe(15);
    // Verify CPU percentages add up to 100
    expect(result[0].sql_cpu_pct + result[0].system_idle_pct + result[0].other_process_cpu_pct).toBe(100);
  });

  it('returns empty array when no ring buffer data', async () => {
    const request = createMockRequest([]);
    const result = await collectOsCpu(request);
    expect(result).toEqual([]);
  });

  it('propagates query errors', async () => {
    const request = {
      query: vi.fn().mockRejectedValue(new Error('ring_buffers deprecated')),
    } as never;

    await expect(collectOsCpu(request)).rejects.toThrow('ring_buffers deprecated');
  });
});
