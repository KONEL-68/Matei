import { describe, it, expect, vi } from 'vitest';
import { collectActiveSessions, type ActiveSessionRow } from '../../collector/collectors/active-sessions.js';

function createMockRequest(recordset: Partial<ActiveSessionRow>[]) {
  return {
    query: vi.fn().mockResolvedValue({ recordset }),
  } as never;
}

describe('collectActiveSessions', () => {
  it('returns rows from the query', async () => {
    const rows: Partial<ActiveSessionRow>[] = [
      {
        session_id: 55,
        request_id: 1,
        blocking_session_id: 0,
        session_status: 'running',
        request_status: 'running',
        login_name: 'app_user',
        host_name: 'WEBSERVER01',
        program_name: '.Net SqlClient',
        database_name: 'MyDB',
        command: 'SELECT',
        wait_type: null,
        wait_time_ms: 0,
        elapsed_time_ms: 1500,
        cpu_time_ms: 1200,
        logical_reads: 50000,
        writes: 0,
        collected_at_utc: new Date(),
      },
    ];

    const request = createMockRequest(rows);
    const result = await collectActiveSessions(request);

    expect(result).toHaveLength(1);
    expect(result[0].session_id).toBe(55);
    expect(result[0].login_name).toBe('app_user');
    expect(result[0].database_name).toBe('MyDB');
  });

  it('returns empty array when no active sessions', async () => {
    const request = createMockRequest([]);
    const result = await collectActiveSessions(request);
    expect(result).toEqual([]);
  });

  it('propagates query errors', async () => {
    const request = {
      query: vi.fn().mockRejectedValue(new Error('Connection lost')),
    } as never;

    await expect(collectActiveSessions(request)).rejects.toThrow('Connection lost');
  });

  it('includes blocking session info when present', async () => {
    const rows: Partial<ActiveSessionRow>[] = [
      {
        session_id: 60,
        blocking_session_id: 55,
        session_status: 'suspended',
        request_status: 'suspended',
        login_name: 'blocked_user',
        wait_type: 'LCK_M_X',
        wait_time_ms: 30000,
        collected_at_utc: new Date(),
      },
    ];

    const request = createMockRequest(rows);
    const result = await collectActiveSessions(request);

    expect(result[0].blocking_session_id).toBe(55);
    expect(result[0].wait_type).toBe('LCK_M_X');
    expect(result[0].wait_time_ms).toBe(30000);
  });
});
