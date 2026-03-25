import { describe, it, expect, vi } from 'vitest';
import { collectOsHostInfo, type OsHostInfoRow } from '../../collector/collectors/os-host-info.js';

function createMockRequest(recordset: Partial<OsHostInfoRow>[]) {
  return {
    query: vi.fn().mockResolvedValue({ recordset }),
  } as never;
}

describe('collectOsHostInfo', () => {
  it('returns host OS information', async () => {
    const rows: Partial<OsHostInfoRow>[] = [
      {
        host_platform: 'Windows',
        host_distribution: 'Windows Server 2022 Datacenter',
        host_release: '10.0',
        host_service_pack_level: '',
        host_sku: 8,
        os_language_version: 1033,
        collected_at_utc: new Date(),
      },
    ];

    const request = createMockRequest(rows);
    const result = await collectOsHostInfo(request);

    expect(result).toHaveLength(1);
    expect(result[0].host_platform).toBe('Windows');
    expect(result[0].host_distribution).toContain('Windows Server');
    expect(result[0].os_language_version).toBe(1033);
  });

  it('handles Linux host info', async () => {
    const rows: Partial<OsHostInfoRow>[] = [
      {
        host_platform: 'Linux',
        host_distribution: 'Ubuntu 22.04.3 LTS',
        host_release: '5.15.0-88-generic',
        host_service_pack_level: '',
        host_sku: 0,
        os_language_version: 1033,
        collected_at_utc: new Date(),
      },
    ];

    const request = createMockRequest(rows);
    const result = await collectOsHostInfo(request);

    expect(result).toHaveLength(1);
    expect(result[0].host_platform).toBe('Linux');
    expect(result[0].host_distribution).toContain('Ubuntu');
  });

  it('propagates query errors', async () => {
    const request = {
      query: vi.fn().mockRejectedValue(new Error('DMV not available')),
    } as never;

    await expect(collectOsHostInfo(request)).rejects.toThrow('DMV not available');
  });
});
