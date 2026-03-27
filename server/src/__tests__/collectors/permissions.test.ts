import { describe, it, expect, vi } from 'vitest';
import { collectPermissions } from '../../collector/collectors/permissions.js';

describe('permissions collector', () => {
  it('returns role membership from query result', async () => {
    const mockRequest = {
      query: vi.fn().mockResolvedValue({
        recordset: [
          { role_name: 'sysadmin', login_name: 'sa', login_type: 'SQL login' },
          { role_name: 'sysadmin', login_name: 'DOMAIN\\DBA', login_type: 'Windows login' },
          { role_name: 'dbcreator', login_name: 'app_user', login_type: 'SQL login' },
        ],
      }),
    };

    const result = await collectPermissions(mockRequest as never);
    expect(result).toHaveLength(3);
    expect(result[0].role_name).toBe('sysadmin');
    expect(result[0].login_name).toBe('sa');
    expect(result[0].login_type).toBe('SQL login');
    expect(result[1].login_type).toBe('Windows login');
    expect(result[2].role_name).toBe('dbcreator');
  });

  it('returns empty array when no role members', async () => {
    const mockRequest = {
      query: vi.fn().mockResolvedValue({ recordset: [] }),
    };

    const result = await collectPermissions(mockRequest as never);
    expect(result).toHaveLength(0);
  });
});
