import { describe, it, expect, vi } from 'vitest';
import { collectServerConfig } from '../../collector/collectors/server-config.js';

describe('server-config collector', () => {
  it('returns server configuration from query result', async () => {
    const mockRequest = {
      query: vi.fn().mockResolvedValue({
        recordset: [
          {
            server_collation: 'SQL_Latin1_General_CP1_CI_AS',
            xp_cmdshell: 0,
            clr_enabled: 0,
            external_scripts_enabled: 0,
            remote_access: 1,
            max_degree_of_parallelism: 4,
            max_server_memory_mb: 16384,
            cost_threshold_for_parallelism: 50,
          },
        ],
      }),
    };

    const result = await collectServerConfig(mockRequest as never);
    expect(result).toHaveLength(1);
    expect(result[0].server_collation).toBe('SQL_Latin1_General_CP1_CI_AS');
    expect(result[0].xp_cmdshell).toBe(0);
    expect(result[0].max_degree_of_parallelism).toBe(4);
    expect(result[0].max_server_memory_mb).toBe(16384);
    expect(result[0].cost_threshold_for_parallelism).toBe(50);
  });

  it('returns empty array when no data', async () => {
    const mockRequest = {
      query: vi.fn().mockResolvedValue({ recordset: [] }),
    };

    const result = await collectServerConfig(mockRequest as never);
    expect(result).toHaveLength(0);
  });
});
