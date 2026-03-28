import type sql from 'mssql';

/** A single blocker-blocked pair parsed from a blocked_process_report event. */
export interface BlockedProcessPair {
  event_time: Date;
  duration_ms: number;
  blocked_spid: number;
  blocked_login: string | null;
  blocked_hostname: string | null;
  blocked_database: string | null;
  blocked_app: string | null;
  blocked_wait_type: string | null;
  blocked_wait_time_ms: number;
  blocked_wait_resource: string | null;
  blocked_sql: string | null;
  blocker_spid: number;
  blocker_login: string | null;
  blocker_hostname: string | null;
  blocker_database: string | null;
  blocker_app: string | null;
  blocker_sql: string | null;
}

/** A chain node stored in chain_json. */
export interface BlockingChainNode {
  spid: number;
  login: string | null;
  hostname: string | null;
  database: string | null;
  app: string | null;
  wait_type: string | null;
  wait_time_ms: number;
  wait_resource: string | null;
  sql_text: string | null;
  blocked_by: number | null;
}

/** A row to insert into blocking_events table. */
export interface BlockingEventRow {
  event_time: Date;
  head_blocker_spid: number;
  head_blocker_login: string | null;
  head_blocker_host: string | null;
  head_blocker_app: string | null;
  head_blocker_db: string | null;
  head_blocker_sql: string | null;
  chain_json: BlockingChainNode[];
  total_blocked_count: number;
  max_wait_time_ms: number;
}

// Track last collected time per instance
const lastCollectedTime = new Map<number, Date>();

// Track which instances have the matei_blocking XE session (avoid repeated error logging)
const blockingSessionSupported = new Map<number, boolean>();

// Track whether we've already ensured the XE session exists per instance
// Keyed by instance ID, stores the sqlserver_start_time when we last checked.
// Reset on SQL Server restart (start_time change).
const xeSessionEnsured = new Map<number, string>();

// Track instances where CREATE EVENT SESSION failed (insufficient permissions etc.)
// Don't retry these every cycle — only reset on SQL Server restart.
const xeSessionCreateFailed = new Map<number, boolean>();

// Default lookback on first collection: 5 minutes
const FIRST_RUN_LOOKBACK_MS = 5 * 60 * 1000;

// Time window (ms) to group events together for chain building
const GROUP_WINDOW_MS = 10_000;

// Fetch the entire ring buffer as a single string. All XML parsing (event shredding,
// timestamp filtering, field extraction) is done in Node.js to avoid SQL Server
// XPath timeouts on large ring buffers.
const QUERY = `
SELECT CAST(target_data AS NVARCHAR(MAX)) AS ring_buffer_xml
FROM sys.dm_xe_session_targets st
JOIN sys.dm_xe_sessions s ON s.address = st.event_session_address
WHERE s.name = 'matei_blocking'
  AND st.target_name = 'ring_buffer'
`;

/** Extract an XML attribute value using regex. */
function xmlAttr(xml: string, tag: string, attr: string): string | null {
  // Match <tag ... attr="value" ...> — handles both self-closing and regular tags
  const tagRegex = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 's');
  const m = xml.match(tagRegex);
  return m ? m[1] : null;
}

/** Extract text content of an XML element. */
function xmlText(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(regex);
  return m ? m[1].trim() : null;
}

/** Extract a section of XML by tag name. */
function xmlSection(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'i');
  const m = xml.match(regex);
  return m ? m[0] : null;
}

/**
 * Parse a SQL Server result row into a BlockedProcessPair.
 * The row contains event_time_utc, duration_ms, and report_xml (raw XML string).
 * XML parsing is done in Node.js with regex for performance.
 * Exported for testing.
 */
export function parseBlockedProcessReport(row: Record<string, unknown>): BlockedProcessPair {
  const reportXml = (row.report_xml as string) || '';
  const blockedSection = xmlSection(reportXml, 'blocked-process') || '';
  const blockerSection = xmlSection(reportXml, 'blocking-process') || '';

  return {
    event_time: new Date(row.event_time_utc as string),
    duration_ms: Number(row.duration_ms) || 0,
    blocked_spid: Number(xmlAttr(blockedSection, 'process', 'spid')) || 0,
    blocked_login: xmlAttr(blockedSection, 'process', 'loginname'),
    blocked_hostname: xmlAttr(blockedSection, 'process', 'hostname'),
    blocked_database: xmlAttr(blockedSection, 'process', 'databasename') ?? xmlAttr(blockedSection, 'process', 'currentdb'),
    blocked_app: xmlAttr(blockedSection, 'process', 'clientapp'),
    blocked_wait_type: xmlAttr(blockedSection, 'process', 'waittype'),
    blocked_wait_time_ms: Number(xmlAttr(blockedSection, 'process', 'waittime')) || 0,
    blocked_wait_resource: xmlAttr(blockedSection, 'process', 'waitresource'),
    blocked_sql: xmlText(blockedSection, 'inputbuf'),
    blocker_spid: Number(xmlAttr(blockerSection, 'process', 'spid')) || 0,
    blocker_login: xmlAttr(blockerSection, 'process', 'loginname'),
    blocker_hostname: xmlAttr(blockerSection, 'process', 'hostname'),
    blocker_database: xmlAttr(blockerSection, 'process', 'databasename') ?? xmlAttr(blockerSection, 'process', 'currentdb'),
    blocker_app: xmlAttr(blockerSection, 'process', 'clientapp'),
    blocker_sql: xmlText(blockerSection, 'inputbuf'),
  };
}

/**
 * Build blocking chains from an array of blocker-blocked pairs.
 * Groups events within 10 seconds of each other, builds a directed graph,
 * and returns one BlockingEventRow per head blocker.
 * Exported for testing.
 */
export function buildBlockingChains(pairs: BlockedProcessPair[]): BlockingEventRow[] {
  if (pairs.length === 0) return [];

  // Sort by event_time ascending for grouping
  const sorted = [...pairs].sort((a, b) => a.event_time.getTime() - b.event_time.getTime());

  // Group events that are within GROUP_WINDOW_MS of each other
  const groups: BlockedProcessPair[][] = [];
  let currentGroup: BlockedProcessPair[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = currentGroup[currentGroup.length - 1];
    if (sorted[i].event_time.getTime() - prev.event_time.getTime() <= GROUP_WINDOW_MS) {
      currentGroup.push(sorted[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [sorted[i]];
    }
  }
  groups.push(currentGroup);

  const results: BlockingEventRow[] = [];

  for (const group of groups) {
    // Build a directed graph: blocker_spid -> set of blocked_spids
    const blockerToBlocked = new Map<number, Set<number>>();
    const allBlockedSpids = new Set<number>();
    const allBlockerSpids = new Set<number>();

    // Track best info per SPID (latest event wins for details)
    const spidInfo = new Map<number, {
      login: string | null;
      hostname: string | null;
      database: string | null;
      app: string | null;
      sql_text: string | null;
      wait_type: string | null;
      wait_time_ms: number;
      wait_resource: string | null;
      blocked_by: number | null;
    }>();

    for (const pair of group) {
      // Track graph edges
      allBlockerSpids.add(pair.blocker_spid);
      allBlockedSpids.add(pair.blocked_spid);

      if (!blockerToBlocked.has(pair.blocker_spid)) {
        blockerToBlocked.set(pair.blocker_spid, new Set());
      }
      blockerToBlocked.get(pair.blocker_spid)!.add(pair.blocked_spid);

      // Store/update blocker info (no wait info for blockers)
      if (!spidInfo.has(pair.blocker_spid)) {
        spidInfo.set(pair.blocker_spid, {
          login: pair.blocker_login,
          hostname: pair.blocker_hostname,
          database: pair.blocker_database,
          app: pair.blocker_app,
          sql_text: pair.blocker_sql,
          wait_type: null,
          wait_time_ms: 0,
          wait_resource: null,
          blocked_by: null,
        });
      }

      // Store/update blocked process info (keep highest wait_time)
      const existing = spidInfo.get(pair.blocked_spid);
      if (!existing || pair.blocked_wait_time_ms > existing.wait_time_ms) {
        spidInfo.set(pair.blocked_spid, {
          login: pair.blocked_login,
          hostname: pair.blocked_hostname,
          database: pair.blocked_database,
          app: pair.blocked_app,
          sql_text: pair.blocked_sql,
          wait_type: pair.blocked_wait_type,
          wait_time_ms: pair.blocked_wait_time_ms,
          wait_resource: pair.blocked_wait_resource,
          blocked_by: pair.blocker_spid,
        });
      }
    }

    // Head blockers: SPIDs that block others but are NOT blocked themselves
    const headBlockers = [...allBlockerSpids].filter(spid => !allBlockedSpids.has(spid));

    // If no clear head blocker (circular), use all blocker SPIDs
    const heads = headBlockers.length > 0 ? headBlockers : [...allBlockerSpids];

    for (const headSpid of heads) {
      const info = spidInfo.get(headSpid);
      if (!info) continue;

      // Build chain: collect all nodes reachable from this head blocker
      const chain: BlockingChainNode[] = [];
      const visited = new Set<number>();
      const queue = [headSpid];

      while (queue.length > 0) {
        const spid = queue.shift()!;
        if (visited.has(spid)) continue;
        visited.add(spid);

        const nodeInfo = spidInfo.get(spid);
        if (nodeInfo) {
          chain.push({
            spid,
            login: nodeInfo.login,
            hostname: nodeInfo.hostname,
            database: nodeInfo.database,
            app: nodeInfo.app,
            wait_type: nodeInfo.wait_type,
            wait_time_ms: nodeInfo.wait_time_ms,
            wait_resource: nodeInfo.wait_resource,
            sql_text: nodeInfo.sql_text,
            blocked_by: spid === headSpid ? null : nodeInfo.blocked_by,
          });
        }

        // Enqueue all processes blocked by this SPID
        const blockedSet = blockerToBlocked.get(spid);
        if (blockedSet) {
          for (const blockedSpid of blockedSet) {
            if (!visited.has(blockedSpid)) {
              queue.push(blockedSpid);
            }
          }
        }
      }

      // Count blocked processes (exclude head blocker)
      const blockedCount = chain.length - 1;
      if (blockedCount <= 0) continue;

      // Max wait time across all blocked processes
      const maxWaitTime = Math.max(...chain.filter(n => n.blocked_by !== null).map(n => n.wait_time_ms));

      // Use the median event time for the group
      const eventTime = group[Math.floor(group.length / 2)].event_time;

      results.push({
        event_time: eventTime,
        head_blocker_spid: headSpid,
        head_blocker_login: info.login,
        head_blocker_host: info.hostname,
        head_blocker_app: info.app,
        head_blocker_db: info.database,
        head_blocker_sql: info.sql_text,
        chain_json: chain,
        total_blocked_count: blockedCount,
        max_wait_time_ms: maxWaitTime,
      });
    }
  }

  return results;
}

/**
 * Ensure the matei_blocking XE session exists and is running on the target instance.
 * Uses a per-instance Map to avoid checking every cycle. Resets tracking on SQL Server restart.
 * If CREATE fails (e.g., insufficient permissions), marks the instance as unsupported and
 * does not retry until SQL Server restarts.
 */
export async function ensureBlockingXeSession(
  request: sql.Request,
  instanceId: number,
  sqlserverStartTime: Date,
): Promise<boolean> {
  const startTimeKey = sqlserverStartTime.toISOString();

  // If SQL Server restarted, reset our tracking for this instance
  const previousStartTime = xeSessionEnsured.get(instanceId);
  if (previousStartTime && previousStartTime !== startTimeKey) {
    xeSessionEnsured.delete(instanceId);
    xeSessionCreateFailed.delete(instanceId);
    blockingSessionSupported.delete(instanceId);
  }

  // Already ensured this cycle (same start_time)
  if (xeSessionEnsured.get(instanceId) === startTimeKey) {
    return !xeSessionCreateFailed.get(instanceId);
  }

  // Previously failed to create — don't retry
  if (xeSessionCreateFailed.get(instanceId)) {
    return false;
  }

  try {
    // Check if the session is running with the correct event and target
    const checkResult = await request.query(`
      SELECT
        CASE WHEN EXISTS (
          SELECT 1 FROM sys.dm_xe_sessions WHERE name = 'matei_blocking'
        ) THEN 1 ELSE 0 END AS is_running,
        CASE WHEN EXISTS (
          SELECT 1 FROM sys.server_event_sessions s
          JOIN sys.server_event_session_events e ON e.event_session_id = s.event_session_id
          JOIN sys.server_event_session_targets t ON t.event_session_id = s.event_session_id
          WHERE s.name = 'matei_blocking'
            AND e.name = 'blocked_process_report'
            AND t.name = 'ring_buffer'
        ) THEN 1 ELSE 0 END AS is_valid,
        CASE WHEN EXISTS (
          SELECT 1 FROM sys.server_event_sessions WHERE name = 'matei_blocking'
        ) THEN 1 ELSE 0 END AS session_exists
    `);

    const row = checkResult.recordset[0];
    const isRunning = row?.is_running === 1;
    const isValid = row?.is_valid === 1;
    const sessionExists = row?.session_exists === 1;

    if (isRunning && isValid) {
      // Session exists, is running, and has the correct config
      xeSessionEnsured.set(instanceId, startTimeKey);
      return true;
    }

    // Session exists but misconfigured — drop and recreate
    if (sessionExists && !isValid) {
      if (isRunning) {
        await request.query(`ALTER EVENT SESSION [matei_blocking] ON SERVER STATE = STOP`);
      }
      await request.query(`DROP EVENT SESSION [matei_blocking] ON SERVER`);
    }

    // Create and start the session
    await request.query(`
      CREATE EVENT SESSION [matei_blocking] ON SERVER
      ADD EVENT sqlserver.blocked_process_report
      ADD TARGET package0.ring_buffer (SET max_memory = 4096)
      WITH (MAX_DISPATCH_LATENCY = 5 SECONDS, STARTUP_STATE = ON);

      ALTER EVENT SESSION [matei_blocking] ON SERVER STATE = START;
    `);

    xeSessionEnsured.set(instanceId, startTimeKey);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Log once, then suppress future attempts for this instance
    console.error(
      `[instance=${instanceId}] Failed to create matei_blocking XE session: ${msg}. ` +
      `Blocking events will not be collected for this instance until SQL Server restarts.`,
    );
    xeSessionCreateFailed.set(instanceId, true);
    xeSessionEnsured.set(instanceId, startTimeKey);
    return false;
  }
}

/**
 * Collect blocking events from the matei_blocking XE session.
 * Returns new blocking chains since last collection.
 * If the XE session doesn't exist, returns [].
 */
/**
 * Split the ring buffer XML string into individual event XML fragments.
 * Filters by timestamp > since. All parsing done in Node.js (no SQL Server XPath).
 */
export function parseRingBuffer(xml: string, since: Date): Array<{ event_time_utc: string; duration_ms: number; report_xml: string }> {
  const results: Array<{ event_time_utc: string; duration_ms: number; report_xml: string }> = [];

  // Match each <event name="blocked_process_report" ...>...</event>
  const eventRegex = /<event\s+name="blocked_process_report"[^>]*timestamp="([^"]*)"[^>]*>([\s\S]*?)<\/event>/g;
  let match;
  while ((match = eventRegex.exec(xml)) !== null) {
    const timestamp = match[1];
    const eventBody = match[2];

    // Filter by timestamp
    const eventDate = new Date(timestamp);
    if (eventDate <= since) continue;

    // Extract duration
    const durationMatch = eventBody.match(/<data\s+name="duration"[^>]*>[\s\S]*?<value>(\d+)<\/value>/);
    const durationUs = durationMatch ? Number(durationMatch[1]) : 0;

    // Extract blocked_process report XML
    const reportMatch = eventBody.match(/<data\s+name="blocked_process"[^>]*>[\s\S]*?<value>([\s\S]*?)<\/value>/);
    const reportXml = reportMatch ? reportMatch[1] : '';

    if (reportXml) {
      results.push({
        event_time_utc: timestamp,
        duration_ms: Math.round(durationUs / 1000),
        report_xml: reportXml,
      });
    }
  }

  return results;
}

export async function collectBlockingEvents(
  request: sql.Request,
  instanceId: number,
  dbNameRequest?: sql.Request,
): Promise<BlockingEventRow[]> {
  // Skip if we already know this instance doesn't have the session
  if (blockingSessionSupported.get(instanceId) === false) {
    return [];
  }

  const since = lastCollectedTime.get(instanceId)
    ?? new Date(Date.now() - FIRST_RUN_LOOKBACK_MS);

  let result;
  try {
    result = await request.query(QUERY);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('matei_blocking') || msg.includes('ring_buffer') || msg.includes('dm_xe_session')) {
      blockingSessionSupported.set(instanceId, false);
    }
    return [];
  }

  // Mark as supported since query succeeded
  blockingSessionSupported.set(instanceId, true);

  const ringBufferXml = result.recordset[0]?.ring_buffer_xml as string | undefined;
  if (!ringBufferXml) return [];

  // Parse ring buffer XML in Node.js — fast regex, no SQL Server XPath
  const events = parseRingBuffer(ringBufferXml, since);

  // Parse all events into pairs
  const pairs: BlockedProcessPair[] = [];
  let latestTime = since;

  for (const row of events) {
    const pair = parseBlockedProcessReport(row);
    if (pair.blocker_spid === 0 || pair.blocked_spid === 0) continue;
    pairs.push(pair);

    if (pair.event_time > latestTime) {
      latestTime = pair.event_time;
    }
  }

  if (pairs.length > 0) {
    lastCollectedTime.set(instanceId, latestTime);
  }

  // Resolve numeric database IDs to names
  if (pairs.length > 0 && dbNameRequest) {
    try {
      const dbResult = await dbNameRequest.query(
        `SELECT database_id, name FROM sys.databases`,
      );
      const dbMap = new Map<string, string>();
      for (const row of dbResult.recordset) {
        dbMap.set(String(row.database_id), row.name);
      }
      for (const pair of pairs) {
        if (pair.blocked_database && /^\d+$/.test(pair.blocked_database)) {
          pair.blocked_database = dbMap.get(pair.blocked_database) ?? pair.blocked_database;
        }
        if (pair.blocker_database && /^\d+$/.test(pair.blocker_database)) {
          pair.blocker_database = dbMap.get(pair.blocker_database) ?? pair.blocker_database;
        }
      }
    } catch { /* non-critical — keep numeric IDs */ }
  }

  // Build chains from pairs
  const chains = buildBlockingChains(pairs);

  // Deduplicate: merge chains from the same ongoing blocking scenario.
  // Key on SPID + login + database + SQL text hash to handle SPID reuse
  // (SQL Server recycles SPIDs, so different users can get the same SPID).
  const merged = new Map<string, BlockingEventRow>();
  for (const chain of chains) {
    const key = `${chain.head_blocker_spid}|${chain.head_blocker_login ?? ''}|${chain.head_blocker_db ?? ''}|${(chain.head_blocker_sql ?? '').slice(0, 100)}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, chain);
    } else {
      // Keep earliest event_time (first occurrence) but latest chain/wait data
      const firstTime = chain.event_time < existing.event_time ? chain.event_time : existing.event_time;
      const latest = chain.event_time > existing.event_time ? chain : existing;
      merged.set(key, { ...latest, event_time: firstTime });
    }
  }

  return [...merged.values()];
}

/** Reset all state (used in testing). */
export function resetBlockingEventsState(): void {
  lastCollectedTime.clear();
  blockingSessionSupported.clear();
  xeSessionEnsured.clear();
  xeSessionCreateFailed.clear();
}
