import { describe, it, expect, vi } from 'vitest';
import { collectMemoryClerks, type MemoryClerkRow } from '../../collector/collectors/memory-clerks.js';

function createMockRequest(recordset: Partial<MemoryClerkRow>[]) {
  return {
    query: vi.fn().mockResolvedValue({ recordset }),
  } as never;
}

describe('collectMemoryClerks', () => {
  it('returns memory clerk data', async () => {
    const rows: Partial<MemoryClerkRow>[] = [
      { clerk_type: 'MEMORYCLERK_SQLBUFFERPOOL', size_mb: 4096.5 },
      { clerk_type: 'CACHESTORE_SQLCP', size_mb: 512.25 },
      { clerk_type: 'MEMORYCLERK_SQLQUERYPLAN', size_mb: 256.0 },
    ];

    const request = createMockRequest(rows);
    const result = await collectMemoryClerks(request);

    expect(result).toHaveLength(3);
    expect(result[0].clerk_type).toBe('MEMORYCLERK_SQLBUFFERPOOL');
    expect(result[0].size_mb).toBe(4096.5);
    expect(result[1].clerk_type).toBe('CACHESTORE_SQLCP');
  });

  it('returns empty array when query returns no rows', async () => {
    const request = createMockRequest([]);
    const result = await collectMemoryClerks(request);
    expect(result).toEqual([]);
  });

  it('propagates query errors', async () => {
    const request = {
      query: vi.fn().mockRejectedValue(new Error('VIEW SERVER STATE required')),
    } as never;

    await expect(collectMemoryClerks(request)).rejects.toThrow('VIEW SERVER STATE required');
  });
});
