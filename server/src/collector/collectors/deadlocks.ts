import type sql from 'mssql';

export interface DeadlockRow {
  deadlock_time: Date;
  victim_spid: number | null;
  victim_query: string | null;
  deadlock_xml: string;
}

// Track last collected deadlock time per instance
const lastCollectedTime = new Map<number, Date>();

// Default lookback on first collection: 5 minutes
const FIRST_RUN_LOOKBACK_MS = 5 * 60 * 1000;

const QUERY = `
SELECT
    xed.value('(@timestamp)[1]', 'DATETIMEOFFSET') AT TIME ZONE 'UTC' AS deadlock_time_utc,
    xed.query('.') AS deadlock_graph
FROM (
    SELECT CAST(target_data AS XML) AS target_data
    FROM sys.dm_xe_session_targets st
    JOIN sys.dm_xe_sessions s ON s.address = st.event_session_address
    WHERE s.name = 'system_health'
      AND st.target_name = 'ring_buffer'
) AS data
CROSS APPLY target_data.nodes('RingBufferTarget/event[@name="xml_deadlock_report"]') AS xev(xed)
WHERE xed.value('(@timestamp)[1]', 'DATETIMEOFFSET') > @since
ORDER BY deadlock_time_utc DESC
`;

/**
 * Parse victim SPID and query from deadlock XML string.
 * The deadlock graph has structure:
 *   <event><data name="xml_deadlock_report"><value><deadlock>
 *     <victim-list><victimProcess id="processXXX" />
 *     <process-list><process id="processXXX" spid="55" ...>
 *       <inputbuf>SELECT ...</inputbuf>
 * Exported for testing.
 */
export function parseDeadlockXml(xml: string): { victimSpid: number | null; victimQuery: string | null } {
  // Extract victim process id
  const victimMatch = xml.match(/<victimProcess\s+id="([^"]+)"/);
  if (!victimMatch) {
    return { victimSpid: null, victimQuery: null };
  }
  const victimId = victimMatch[1];

  // Find the process element matching the victim id to get SPID
  // Pattern: <process id="processXXX" ... spid="55" ...>
  const processRegex = new RegExp(
    `<process\\s+id="${escapeRegex(victimId)}"[^>]*?\\bspid="(\\d+)"`,
  );
  const spidMatch = xml.match(processRegex);
  const victimSpid = spidMatch ? parseInt(spidMatch[1], 10) : null;

  // Extract inputbuf for the victim process
  // Look for the process block with the victim id and extract its inputbuf
  const processBlockRegex = new RegExp(
    `<process\\s+id="${escapeRegex(victimId)}"[\\s\\S]*?<inputbuf>([\\s\\S]*?)</inputbuf>`,
  );
  const queryMatch = xml.match(processBlockRegex);
  const victimQuery = queryMatch ? queryMatch[1].trim() : null;

  return { victimSpid, victimQuery };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Collect deadlocks from system_health XE session.
 * Returns new deadlocks since last collection.
 */
export async function collectDeadlocks(
  request: sql.Request,
  instanceId: number,
): Promise<DeadlockRow[]> {
  const since = lastCollectedTime.get(instanceId)
    ?? new Date(Date.now() - FIRST_RUN_LOOKBACK_MS);

  request.input('since', since);

  let result;
  try {
    result = await request.query(QUERY);
  } catch {
    // system_health session may not be available or XE permissions missing
    return [];
  }

  const rows: DeadlockRow[] = [];
  let latestTime = since;

  for (const row of result.recordset) {
    const deadlockTime = new Date(row.deadlock_time_utc);
    const xml = String(row.deadlock_graph);

    const { victimSpid, victimQuery } = parseDeadlockXml(xml);

    rows.push({
      deadlock_time: deadlockTime,
      victim_spid: victimSpid,
      victim_query: victimQuery,
      deadlock_xml: xml,
    });

    if (deadlockTime > latestTime) {
      latestTime = deadlockTime;
    }
  }

  if (rows.length > 0) {
    lastCollectedTime.set(instanceId, latestTime);
  }

  return rows;
}

/** Reset all state (used in testing). */
export function resetDeadlockState(): void {
  lastCollectedTime.clear();
}
