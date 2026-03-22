import { describe, it, expect, beforeEach } from 'vitest';
import { parseDeadlockXml, collectDeadlocks, resetDeadlockState } from '../../collector/collectors/deadlocks.js';

describe('deadlock XML parsing', () => {
  const sampleXml = `
<event name="xml_deadlock_report" timestamp="2026-03-22T10:15:30.123Z">
  <data name="xml_deadlock_report">
    <value>
      <deadlock>
        <victim-list>
          <victimProcess id="process2a1b3c" />
        </victim-list>
        <process-list>
          <process id="process2a1b3c" taskpriority="0" logused="0" waitresource="KEY: 5:72057594044284928 (1234abcd)"
                   waittime="5000" ownerId="123456" transactionname="user_transaction"
                   lasttranstarted="2026-03-22T10:15:25.000Z" XDES="0x12345678"
                   lockMode="X" schedulerid="1" kpid="4567" status="suspended"
                   spid="55" sbid="0" ecid="0" priority="0" trancount="1"
                   lastbatchstarted="2026-03-22T10:15:25.000Z" lastbatchcompleted="2026-03-22T10:15:24.000Z"
                   lastattention="1900-01-01T00:00:00.000Z" clientapp=".Net SqlClient Data Provider"
                   hostname="WEBSERVER01" hostpid="12345" loginname="app_user"
                   isolationlevel="read committed (2)" xactid="123456" currentdb="5" currentdbname="MyDB">
            <executionStack>
              <frame procname="MyDB.dbo.sp_UpdateOrder" line="42" />
            </executionStack>
            <inputbuf>EXEC dbo.sp_UpdateOrder @OrderId = 12345</inputbuf>
          </process>
          <process id="process3d4e5f" taskpriority="0" logused="0" waitresource="KEY: 5:72057594044284929 (5678efgh)"
                   waittime="3000" ownerId="123457"
                   spid="67" sbid="0" ecid="0" priority="0" trancount="1"
                   loginname="app_user" currentdbname="MyDB">
            <inputbuf>UPDATE Orders SET Status = 'shipped' WHERE OrderId = 67890</inputbuf>
          </process>
        </process-list>
        <resource-list>
          <keylock hobtid="72057594044284928" dbid="5" objectname="MyDB.dbo.Orders" indexname="PK_Orders" id="lock1" mode="X" associatedObjectId="72057594044284928">
            <owner-list>
              <owner id="process3d4e5f" mode="X" />
            </owner-list>
            <waiter-list>
              <waiter id="process2a1b3c" mode="X" requestType="wait" />
            </waiter-list>
          </keylock>
        </resource-list>
      </deadlock>
    </value>
  </data>
</event>`;

  it('extracts victim SPID correctly', () => {
    const { victimSpid } = parseDeadlockXml(sampleXml);
    expect(victimSpid).toBe(55);
  });

  it('extracts victim query from inputbuf', () => {
    const { victimQuery } = parseDeadlockXml(sampleXml);
    expect(victimQuery).toBe('EXEC dbo.sp_UpdateOrder @OrderId = 12345');
  });

  it('handles XML with no victim-list', () => {
    const xml = '<event><data><value><deadlock><process-list></process-list></deadlock></value></data></event>';
    const { victimSpid, victimQuery } = parseDeadlockXml(xml);
    expect(victimSpid).toBeNull();
    expect(victimQuery).toBeNull();
  });

  it('handles empty string', () => {
    const { victimSpid, victimQuery } = parseDeadlockXml('');
    expect(victimSpid).toBeNull();
    expect(victimQuery).toBeNull();
  });

  it('handles XML where victim process has no inputbuf', () => {
    const xml = `
      <event>
        <data name="xml_deadlock_report"><value><deadlock>
          <victim-list><victimProcess id="proc1" /></victim-list>
          <process-list>
            <process id="proc1" spid="42"></process>
          </process-list>
        </deadlock></value></data>
      </event>`;
    const { victimSpid, victimQuery } = parseDeadlockXml(xml);
    expect(victimSpid).toBe(42);
    expect(victimQuery).toBeNull();
  });
});

describe('deadlock collector', () => {
  beforeEach(() => {
    resetDeadlockState();
  });

  it('returns empty array when system_health session unavailable', async () => {
    const mockRequest = {
      input: () => mockRequest,
      query: async () => { throw new Error('XE not available'); },
    } as never;

    const result = await collectDeadlocks(mockRequest, 1);
    expect(result).toEqual([]);
  });

  it('returns empty array when no deadlocks found', async () => {
    const mockRequest = {
      input: () => mockRequest,
      query: async () => ({ recordset: [] }),
    } as never;

    const result = await collectDeadlocks(mockRequest, 1);
    expect(result).toEqual([]);
  });

  it('parses deadlock rows from query result', async () => {
    const mockRequest = {
      input: () => mockRequest,
      query: async () => ({
        recordset: [
          {
            deadlock_time_utc: '2026-03-22T10:15:30.000Z',
            deadlock_graph: `<event><data name="xml_deadlock_report"><value><deadlock>
              <victim-list><victimProcess id="p1" /></victim-list>
              <process-list><process id="p1" spid="55"><inputbuf>SELECT 1</inputbuf></process></process-list>
            </deadlock></value></data></event>`,
          },
        ],
      }),
    } as never;

    const result = await collectDeadlocks(mockRequest, 1);
    expect(result).toHaveLength(1);
    expect(result[0].victim_spid).toBe(55);
    expect(result[0].victim_query).toBe('SELECT 1');
    expect(result[0].deadlock_time).toBeInstanceOf(Date);
  });
});
