import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseBlockedProcessReport,
  buildBlockingChains,
  collectBlockingEvents,
  ensureBlockingXeSession,
  resetBlockingEventsState,
  type BlockedProcessPair,
} from '../../collector/collectors/blocking-events.js';

describe('parseBlockedProcessReport', () => {
  it('extracts blocker and blocked details from a result row', () => {
    const row = {
      event_time_utc: '2026-03-28T10:00:00.000Z',
      duration_ms: 15000,
      blocked_spid: 55,
      blocked_login: 'app_user',
      blocked_hostname: 'WEBSERVER01',
      blocked_database: 'Sales',
      blocked_app: 'MyApp',
      blocked_wait_type: 'LCK_M_X',
      blocked_wait_time_ms: 15000,
      blocked_wait_resource: 'KEY: 5:72057594044284928',
      blocked_inputbuf: '  SELECT * FROM Orders  ',
      blocker_spid: 60,
      blocker_login: 'admin_user',
      blocker_hostname: 'APPSERVER01',
      blocker_database: 'Sales',
      blocker_app: 'AdminTool',
      blocker_inputbuf: 'UPDATE Orders SET Status = 1',
    };

    const pair = parseBlockedProcessReport(row);
    expect(pair.blocked_spid).toBe(55);
    expect(pair.blocked_login).toBe('app_user');
    expect(pair.blocked_sql).toBe('SELECT * FROM Orders');
    expect(pair.blocker_spid).toBe(60);
    expect(pair.blocker_login).toBe('admin_user');
    expect(pair.blocker_sql).toBe('UPDATE Orders SET Status = 1');
    expect(pair.blocked_wait_type).toBe('LCK_M_X');
    expect(pair.blocked_wait_time_ms).toBe(15000);
    expect(pair.event_time).toBeInstanceOf(Date);
  });

  it('handles null/missing fields gracefully', () => {
    const row = {
      event_time_utc: '2026-03-28T10:00:00.000Z',
      duration_ms: null,
      blocked_spid: 55,
      blocked_login: null,
      blocked_hostname: null,
      blocked_database: null,
      blocked_app: null,
      blocked_wait_type: null,
      blocked_wait_time_ms: null,
      blocked_wait_resource: null,
      blocked_inputbuf: null,
      blocker_spid: 60,
      blocker_login: null,
      blocker_hostname: null,
      blocker_database: null,
      blocker_app: null,
      blocker_inputbuf: null,
    };

    const pair = parseBlockedProcessReport(row);
    expect(pair.blocked_spid).toBe(55);
    expect(pair.blocked_login).toBeNull();
    expect(pair.blocked_sql).toBeNull();
    expect(pair.blocker_spid).toBe(60);
    expect(pair.duration_ms).toBe(0);
    expect(pair.blocked_wait_time_ms).toBe(0);
  });
});

describe('buildBlockingChains', () => {
  it('returns empty array for empty input', () => {
    expect(buildBlockingChains([])).toEqual([]);
  });

  it('builds a simple chain with one head blocker and one blocked', () => {
    const pairs: BlockedProcessPair[] = [
      {
        event_time: new Date('2026-03-28T10:00:00Z'),
        duration_ms: 15000,
        blocked_spid: 55,
        blocked_login: 'app_user',
        blocked_hostname: 'WEB01',
        blocked_database: 'Sales',
        blocked_app: 'MyApp',
        blocked_wait_type: 'LCK_M_X',
        blocked_wait_time_ms: 15000,
        blocked_wait_resource: 'KEY: 5:123',
        blocked_sql: 'SELECT 1',
        blocker_spid: 60,
        blocker_login: 'admin',
        blocker_hostname: 'APP01',
        blocker_database: 'Sales',
        blocker_app: 'AdminTool',
        blocker_sql: 'UPDATE t SET x=1',
      },
    ];

    const chains = buildBlockingChains(pairs);
    expect(chains).toHaveLength(1);
    expect(chains[0].head_blocker_spid).toBe(60);
    expect(chains[0].head_blocker_login).toBe('admin');
    expect(chains[0].total_blocked_count).toBe(1);
    expect(chains[0].max_wait_time_ms).toBe(15000);
    expect(chains[0].chain_json).toHaveLength(2);

    const headNode = chains[0].chain_json.find(n => n.spid === 60);
    expect(headNode?.blocked_by).toBeNull();

    const blockedNode = chains[0].chain_json.find(n => n.spid === 55);
    expect(blockedNode?.blocked_by).toBe(60);
    expect(blockedNode?.wait_type).toBe('LCK_M_X');
  });

  it('builds a chain with one head blocker blocking multiple SPIDs', () => {
    const baseTime = new Date('2026-03-28T10:00:00Z');
    const pairs: BlockedProcessPair[] = [
      {
        event_time: baseTime,
        duration_ms: 10000,
        blocked_spid: 55,
        blocked_login: 'user1',
        blocked_hostname: 'H1',
        blocked_database: 'DB1',
        blocked_app: 'App1',
        blocked_wait_type: 'LCK_M_S',
        blocked_wait_time_ms: 10000,
        blocked_wait_resource: 'KEY: 5:1',
        blocked_sql: 'SELECT a',
        blocker_spid: 60,
        blocker_login: 'admin',
        blocker_hostname: 'H0',
        blocker_database: 'DB1',
        blocker_app: 'Admin',
        blocker_sql: 'UPDATE x',
      },
      {
        event_time: new Date(baseTime.getTime() + 2000),
        duration_ms: 8000,
        blocked_spid: 70,
        blocked_login: 'user2',
        blocked_hostname: 'H2',
        blocked_database: 'DB1',
        blocked_app: 'App2',
        blocked_wait_type: 'LCK_M_S',
        blocked_wait_time_ms: 8000,
        blocked_wait_resource: 'KEY: 5:2',
        blocked_sql: 'SELECT b',
        blocker_spid: 60,
        blocker_login: 'admin',
        blocker_hostname: 'H0',
        blocker_database: 'DB1',
        blocker_app: 'Admin',
        blocker_sql: 'UPDATE x',
      },
    ];

    const chains = buildBlockingChains(pairs);
    expect(chains).toHaveLength(1);
    expect(chains[0].head_blocker_spid).toBe(60);
    expect(chains[0].total_blocked_count).toBe(2);
    expect(chains[0].max_wait_time_ms).toBe(10000);
    expect(chains[0].chain_json).toHaveLength(3);
  });

  it('groups events within 10 seconds and separates events further apart', () => {
    const t1 = new Date('2026-03-28T10:00:00Z');
    const t2 = new Date('2026-03-28T10:01:00Z'); // 60s later, separate group

    const pairs: BlockedProcessPair[] = [
      {
        event_time: t1,
        duration_ms: 5000,
        blocked_spid: 55,
        blocked_login: 'u1',
        blocked_hostname: 'H1',
        blocked_database: 'DB1',
        blocked_app: 'A1',
        blocked_wait_type: 'LCK_M_X',
        blocked_wait_time_ms: 5000,
        blocked_wait_resource: 'KEY: 1',
        blocked_sql: 'S1',
        blocker_spid: 60,
        blocker_login: 'a1',
        blocker_hostname: 'H0',
        blocker_database: 'DB1',
        blocker_app: 'Admin',
        blocker_sql: 'U1',
      },
      {
        event_time: t2,
        duration_ms: 7000,
        blocked_spid: 70,
        blocked_login: 'u2',
        blocked_hostname: 'H2',
        blocked_database: 'DB2',
        blocked_app: 'A2',
        blocked_wait_type: 'LCK_M_S',
        blocked_wait_time_ms: 7000,
        blocked_wait_resource: 'KEY: 2',
        blocked_sql: 'S2',
        blocker_spid: 80,
        blocker_login: 'a2',
        blocker_hostname: 'H3',
        blocker_database: 'DB2',
        blocker_app: 'Admin2',
        blocker_sql: 'U2',
      },
    ];

    const chains = buildBlockingChains(pairs);
    expect(chains).toHaveLength(2);
  });

  it('handles a transitive chain: A blocks B, B blocks C', () => {
    const t = new Date('2026-03-28T10:00:00Z');
    const pairs: BlockedProcessPair[] = [
      {
        event_time: t,
        duration_ms: 20000,
        blocked_spid: 70,
        blocked_login: 'u2',
        blocked_hostname: 'H2',
        blocked_database: 'DB1',
        blocked_app: 'A2',
        blocked_wait_type: 'LCK_M_S',
        blocked_wait_time_ms: 20000,
        blocked_wait_resource: 'KEY: 1',
        blocked_sql: 'S2',
        blocker_spid: 55,
        blocker_login: 'u1',
        blocker_hostname: 'H1',
        blocker_database: 'DB1',
        blocker_app: 'A1',
        blocker_sql: 'S1',
      },
      {
        event_time: new Date(t.getTime() + 1000),
        duration_ms: 25000,
        blocked_spid: 55,
        blocked_login: 'u1',
        blocked_hostname: 'H1',
        blocked_database: 'DB1',
        blocked_app: 'A1',
        blocked_wait_type: 'LCK_M_X',
        blocked_wait_time_ms: 25000,
        blocked_wait_resource: 'KEY: 2',
        blocked_sql: 'S1',
        blocker_spid: 60,
        blocker_login: 'admin',
        blocker_hostname: 'H0',
        blocker_database: 'DB1',
        blocker_app: 'Admin',
        blocker_sql: 'U1',
      },
    ];

    const chains = buildBlockingChains(pairs);
    expect(chains).toHaveLength(1);
    expect(chains[0].head_blocker_spid).toBe(60);
    expect(chains[0].total_blocked_count).toBe(2);
    // Chain should have 3 nodes: 60, 55, 70
    expect(chains[0].chain_json).toHaveLength(3);
  });
});

describe('collectBlockingEvents', () => {
  beforeEach(() => {
    resetBlockingEventsState();
  });

  it('returns empty array when XE session unavailable', async () => {
    const mockRequest = {
      input: () => mockRequest,
      query: async () => { throw new Error('matei_blocking session not found'); },
    } as never;

    const result = await collectBlockingEvents(mockRequest, 1);
    expect(result).toEqual([]);
  });

  it('returns empty array when no events found', async () => {
    const mockRequest = {
      input: () => mockRequest,
      query: async () => ({ recordset: [] }),
    } as never;

    const result = await collectBlockingEvents(mockRequest, 1);
    expect(result).toEqual([]);
  });

  it('suppresses repeated errors after first failure', async () => {
    const mockRequest = {
      input: () => mockRequest,
      query: async () => { throw new Error('matei_blocking not available'); },
    } as never;

    // First call: tries query, fails
    await collectBlockingEvents(mockRequest, 1);

    // Second call: should return [] without even querying
    let queryCalled = false;
    const mockRequest2 = {
      input: () => mockRequest2,
      query: async () => { queryCalled = true; return { recordset: [] }; },
    } as never;

    const result = await collectBlockingEvents(mockRequest2, 1);
    expect(result).toEqual([]);
    expect(queryCalled).toBe(false);
  });

  it('parses blocking events from query result and builds chains', async () => {
    const mockRequest = {
      input: () => mockRequest,
      query: async () => ({
        recordset: [
          {
            event_time_utc: '2026-03-28T10:00:00.000Z',
            duration_ms: 15000,
            blocked_spid: 55,
            blocked_login: 'app_user',
            blocked_hostname: 'WEB01',
            blocked_database: 'Sales',
            blocked_app: 'MyApp',
            blocked_wait_type: 'LCK_M_X',
            blocked_wait_time_ms: 15000,
            blocked_wait_resource: 'KEY: 5:123',
            blocked_inputbuf: 'SELECT 1',
            blocker_spid: 60,
            blocker_login: 'admin',
            blocker_hostname: 'APP01',
            blocker_database: 'Sales',
            blocker_app: 'AdminTool',
            blocker_inputbuf: 'UPDATE Orders SET x=1',
          },
        ],
      }),
    } as never;

    const result = await collectBlockingEvents(mockRequest, 1);
    expect(result).toHaveLength(1);
    expect(result[0].head_blocker_spid).toBe(60);
    expect(result[0].total_blocked_count).toBe(1);
    expect(result[0].chain_json).toHaveLength(2);
  });
});

describe('ensureBlockingXeSession', () => {
  beforeEach(() => {
    resetBlockingEventsState();
  });

  it('returns true when session is already running', async () => {
    const mockRequest = {
      query: async () => ({ recordset: [{ found: 1 }] }),
    } as never;

    const result = await ensureBlockingXeSession(mockRequest, 1, new Date('2026-03-28T00:00:00Z'));
    expect(result).toBe(true);
  });

  it('creates and starts session when not running', async () => {
    const queries: string[] = [];
    const mockRequest = {
      query: async (sql: string) => {
        queries.push(sql);
        // First call: check dm_xe_sessions — not found
        if (queries.length === 1) return { recordset: [] };
        // Second call: CREATE + ALTER
        return { recordset: [] };
      },
    } as never;

    const result = await ensureBlockingXeSession(mockRequest, 1, new Date('2026-03-28T00:00:00Z'));
    expect(result).toBe(true);
    expect(queries).toHaveLength(2);
    expect(queries[1]).toContain('CREATE EVENT SESSION');
  });

  it('skips check on subsequent calls with same start time', async () => {
    let queryCount = 0;
    const mockRequest = {
      query: async () => { queryCount++; return { recordset: [{ found: 1 }] }; },
    } as never;

    const startTime = new Date('2026-03-28T00:00:00Z');
    await ensureBlockingXeSession(mockRequest, 1, startTime);
    expect(queryCount).toBe(1);

    // Second call — should not query again
    await ensureBlockingXeSession(mockRequest, 1, startTime);
    expect(queryCount).toBe(1);
  });

  it('resets tracking on SQL Server restart (start time change)', async () => {
    let queryCount = 0;
    const mockRequest = {
      query: async () => { queryCount++; return { recordset: [{ found: 1 }] }; },
    } as never;

    await ensureBlockingXeSession(mockRequest, 1, new Date('2026-03-28T00:00:00Z'));
    expect(queryCount).toBe(1);

    // SQL Server restarted — different start time
    await ensureBlockingXeSession(mockRequest, 1, new Date('2026-03-28T06:00:00Z'));
    expect(queryCount).toBe(2);
  });

  it('marks instance as unsupported on CREATE failure and does not retry', async () => {
    let queryCount = 0;
    const mockRequest = {
      query: async () => {
        queryCount++;
        // First call: check — not found
        if (queryCount === 1) return { recordset: [] };
        // Second call: CREATE — fails
        throw new Error('ALTER EVENT SESSION permission was denied');
      },
    } as never;

    const startTime = new Date('2026-03-28T00:00:00Z');
    const result = await ensureBlockingXeSession(mockRequest, 1, startTime);
    expect(result).toBe(false);
    expect(queryCount).toBe(2);

    // Should not retry
    const result2 = await ensureBlockingXeSession(mockRequest, 1, startTime);
    expect(result2).toBe(false);
    expect(queryCount).toBe(2); // no new queries
  });

  it('retries after SQL Server restart even if previously failed', async () => {
    let queryCount = 0;
    const failRequest = {
      query: async () => {
        queryCount++;
        if (queryCount === 1) return { recordset: [] };
        throw new Error('permission denied');
      },
    } as never;

    await ensureBlockingXeSession(failRequest, 1, new Date('2026-03-28T00:00:00Z'));
    expect(queryCount).toBe(2);

    // SQL Server restarted — should retry
    const successRequest = {
      query: async () => { queryCount++; return { recordset: [{ found: 1 }] }; },
    } as never;

    const result = await ensureBlockingXeSession(successRequest, 1, new Date('2026-03-28T06:00:00Z'));
    expect(result).toBe(true);
    expect(queryCount).toBe(3);
  });
});
