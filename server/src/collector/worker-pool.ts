import crypto from 'node:crypto';
import sql from 'mssql';
import type pg from 'pg';
import { buildConnectionConfig, type InstanceRecord } from '../lib/mssql.js';
import { collectInstanceHealth, type InstanceHealthRow } from './collectors/instance-health.js';
import { collectWaitStats, type WaitStatsDelta } from './collectors/wait-stats.js';
import { collectActiveSessions, type ActiveSessionRow } from './collectors/active-sessions.js';
import { collectOsCpu, type OsCpuRow } from './collectors/os-cpu.js';
import { collectOsMemory, type OsMemoryRow } from './collectors/os-memory.js';
import { collectOsDisk, type OsDiskRow } from './collectors/os-disk.js';
import { collectFileIoStats, type FileIoDelta } from './collectors/file-io-stats.js';
import { collectQueryStats, type QueryStatsDelta } from './collectors/query-stats.js';
import { collectProcedureStats, collectProcedureStatements, type ProcedureStatsDelta, type ProcedureStatementRow } from './collectors/procedure-stats.js';
import { collectOsHostInfo, type OsHostInfoRow } from './collectors/os-host-info.js';
import { collectDeadlocks, type DeadlockRow } from './collectors/deadlocks.js';
import { collectPerfCounters, type PerfCounterResult } from './collectors/perf-counters.js';
import { collectServerConfig, type ServerConfigRow } from './collectors/server-config.js';
import { collectMemoryClerks, type MemoryClerkRow } from './collectors/memory-clerks.js';
import { collectPermissions, type PermissionsRow } from './collectors/permissions.js';
import { collectBlockingEvents, ensureBlockingXeSession, type BlockingEventRow } from './collectors/blocking-events.js';
import { evaluateAlerts, writeAlerts } from '../alerts/engine.js';
import { fireWebhook } from '../alerts/webhook.js';

export interface CollectorLog {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface InstanceResult {
  instanceId: number;
  success: boolean;
  error?: string;
  health: InstanceHealthRow[];
  waitStats: WaitStatsDelta[] | null;
  activeSessions: ActiveSessionRow[];
  osCpu: OsCpuRow[];
  osMemory: OsMemoryRow[];
  osDisk: OsDiskRow[];
  fileIoStats: FileIoDelta[] | null;
  queryStats: QueryStatsDelta[] | null;
  procedureStats: ProcedureStatsDelta[] | null;
  procedureStatements: ProcedureStatementRow[];
  osHostInfo: OsHostInfoRow[];
  serverConfig: ServerConfigRow[];
  deadlocks: DeadlockRow[];
  perfCounters: PerfCounterResult[] | null;
  memoryClerks: MemoryClerkRow[];
  permissions: PermissionsRow[];
  blockingEvents: BlockingEventRow[];
}

// Track which instances support dm_exec_query_statistics_xml (avoid repeated errors)
const actualPlanSupported = new Map<number, boolean>();

/**
 * Collect estimated + actual query plans during collection cycle and persist to PostgreSQL.
 * Runs after main collectors, uses the same open SQL connection.
 * Non-fatal — failures are logged but don't affect the main collection.
 */
async function collectAndPersistPlans(
  sqlPool: sql.ConnectionPool,
  pgPool: pg.Pool,
  instanceId: number,
  queryStats: QueryStatsDelta[],
  log: CollectorLog,
): Promise<void> {
  // Get top 10 query hashes by CPU to collect plans for (limit scope)
  const topHashes = [...queryStats]
    .sort((a, b) => b.cpu_ms_per_sec - a.cpu_ms_per_sec)
    .slice(0, 10)
    .map(q => q.query_hash);

  if (topHashes.length === 0) return;

  const hashList = topHashes.map(h => `'${h.replace(/'/g, "''")}'`).join(',');

  // 1. Estimated plans (from plan cache — always available)
  try {
    const result = await sqlPool.request().query(`
      ;WITH ranked AS (
        SELECT
          CONVERT(VARCHAR(100), qs.query_hash, 1) AS query_hash,
          qp.query_plan,
          ROW_NUMBER() OVER (PARTITION BY qs.query_hash ORDER BY qs.last_execution_time DESC) AS rn
        FROM sys.dm_exec_query_stats qs
        CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
        WHERE CONVERT(VARCHAR(100), qs.query_hash, 1) IN (${hashList})
          AND qp.query_plan IS NOT NULL
      )
      SELECT query_hash, query_plan FROM ranked WHERE rn = 1
    `);

    for (const row of result.recordset) {
      if (!row.query_plan) continue;
      const planHash = crypto.createHash('md5').update(row.query_plan).digest('hex');
      await pgPool.query(
        `INSERT INTO query_plans (instance_id, query_hash, plan_hash, plan_type, plan_xml)
         VALUES ($1, $2, $3, 'estimated', $4)
         ON CONFLICT (instance_id, query_hash, plan_hash, plan_type) DO UPDATE SET collected_at = NOW()`,
        [instanceId, row.query_hash, planHash, row.query_plan],
      );
    }
    log.info(`[instance=${instanceId}] Collected ${result.recordset.length} estimated plans`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[instance=${instanceId}] Estimated plan collection failed: ${msg}`);
  }

  // 2. Actual plans — scan ALL currently executing requests for any query with a live actual plan
  //    dm_exec_query_statistics_xml only works for currently running queries (TF 7412 / SQL 2019+)
  if (actualPlanSupported.get(instanceId) === false) return;

  try {
    const result = await sqlPool.request().query(`
      SELECT
        CONVERT(VARCHAR(100), r.query_hash, 1) AS query_hash,
        CAST(qsx.query_plan AS NVARCHAR(MAX)) AS query_plan
      FROM sys.dm_exec_requests r
      CROSS APPLY sys.dm_exec_query_statistics_xml(r.session_id) qsx
      WHERE r.session_id <> @@SPID
        AND r.query_hash <> 0x0000000000000000
        AND qsx.query_plan IS NOT NULL
    `);

    actualPlanSupported.set(instanceId, true);

    if (result.recordset.length > 0) {
      for (const row of result.recordset) {
        if (!row.query_plan) continue;
        const planHash = crypto.createHash('md5').update(row.query_plan).digest('hex');
        await pgPool.query(
          `INSERT INTO query_plans (instance_id, query_hash, plan_hash, plan_type, plan_xml)
           VALUES ($1, $2, $3, 'actual', $4)
           ON CONFLICT (instance_id, query_hash, plan_hash, plan_type) DO UPDATE SET collected_at = NOW()`,
          [instanceId, row.query_hash, planHash, row.query_plan],
        );
      }
      log.info(`[instance=${instanceId}] Captured ${result.recordset.length} actual plans from running queries`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('query_statistics_xml') || msg.includes('Invalid object')) {
      actualPlanSupported.set(instanceId, false);
      log.info(`[instance=${instanceId}] Actual plans not supported (dm_exec_query_statistics_xml unavailable)`);
    } else {
      log.warn(`[instance=${instanceId}] Actual plan collection failed: ${msg}`);
    }
  }
}

/**
 * Collect estimated + actual plans for all SPIDs involved in blocking events.
 * Persists to query_plans table keyed by a synthetic query_hash derived from SQL text.
 */
async function collectBlockingPlans(
  sqlPool: sql.ConnectionPool,
  pgPool: pg.Pool,
  instanceId: number,
  blockingEvents: BlockingEventRow[],
  log: CollectorLog,
): Promise<void> {
  // Gather all unique SPIDs from blocking chains
  const spids = new Set<number>();
  for (const evt of blockingEvents) {
    for (const node of evt.chain_json) {
      if (node.spid) spids.add(node.spid);
    }
  }

  if (spids.size === 0) return;

  const spidList = [...spids].join(',');
  let planCount = 0;

  // 1. Estimated plans — get from active requests' plan handles
  try {
    const result = await sqlPool.request().query(`
      SELECT
        r.session_id AS spid,
        CONVERT(VARCHAR(100), r.query_hash, 1) AS query_hash,
        qp.query_plan
      FROM sys.dm_exec_requests r
      CROSS APPLY sys.dm_exec_query_plan(r.plan_handle) qp
      WHERE r.session_id IN (${spidList})
        AND qp.query_plan IS NOT NULL
    `);

    for (const row of result.recordset) {
      if (!row.query_plan) continue;
      const queryHash = row.query_hash || `blocking_spid_${row.spid}`;
      const planHash = crypto.createHash('md5').update(row.query_plan).digest('hex');
      await pgPool.query(
        `INSERT INTO query_plans (instance_id, query_hash, plan_hash, plan_type, plan_xml)
         VALUES ($1, $2, $3, 'estimated', $4)
         ON CONFLICT (instance_id, query_hash, plan_hash, plan_type) DO UPDATE SET collected_at = NOW()`,
        [instanceId, queryHash, planHash, row.query_plan],
      );
      planCount++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[instance=${instanceId}] Blocking estimated plan collection failed: ${msg}`);
  }

  // 2. Actual plans — dm_exec_query_statistics_xml for each blocking SPID
  if (actualPlanSupported.get(instanceId) !== false) {
    for (const spid of spids) {
      try {
        const result = await sqlPool.request()
          .input('spid', spid)
          .query(`
            SELECT
              CONVERT(VARCHAR(100), r.query_hash, 1) AS query_hash,
              CAST(qsx.query_plan AS NVARCHAR(MAX)) AS query_plan
            FROM sys.dm_exec_requests r
            CROSS APPLY sys.dm_exec_query_statistics_xml(r.session_id) qsx
            WHERE r.session_id = @spid
              AND qsx.query_plan IS NOT NULL
          `);

        for (const row of result.recordset) {
          if (!row.query_plan) continue;
          const queryHash = row.query_hash || `blocking_spid_${spid}`;
          const planHash = crypto.createHash('md5').update(row.query_plan).digest('hex');
          await pgPool.query(
            `INSERT INTO query_plans (instance_id, query_hash, plan_hash, plan_type, plan_xml)
             VALUES ($1, $2, $3, 'actual', $4)
             ON CONFLICT (instance_id, query_hash, plan_hash, plan_type) DO UPDATE SET collected_at = NOW()`,
            [instanceId, queryHash, planHash, row.query_plan],
          );
          planCount++;
        }
      } catch {
        // Session may have ended — skip silently
      }
    }
  }

  if (planCount > 0) {
    log.info(`[instance=${instanceId}] Collected ${planCount} plans from blocking sessions`);
  }
}

// Track cycle count for os_disk (runs every 10th cycle)
let cycleCount = 0;

// Track which instances have already had os_host_info collected (static data, once per run)
const hostInfoCollected = new Set<number>();

/** Get current cycle count (for testing). */
export function getCycleCount(): number {
  return cycleCount;
}

/** Reset cycle count (for testing). */
export function resetCycleCount(): void {
  cycleCount = 0;
}

/**
 * Run async tasks with a concurrency limit.
 * Exported for testing.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        const i = index++;
        results[i] = await fn(items[i]);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

async function collectFromInstance(
  instance: InstanceRecord,
  encryptionKey: string,
  isDiskCycle: boolean,
  isQueryStatsCycle: boolean,
  isPermissionsCycle: boolean,
  log: CollectorLog,
  pgPool: pg.Pool,
): Promise<InstanceResult> {
  const empty: InstanceResult = {
    instanceId: instance.id,
    success: false,
    health: [],
    waitStats: null,
    activeSessions: [],
    osCpu: [],
    osMemory: [],
    osDisk: [],
    fileIoStats: null,
    queryStats: null,
    procedureStats: null,
    procedureStatements: [],
    osHostInfo: [],
    serverConfig: [],
    deadlocks: [],
    perfCounters: null,
    memoryClerks: [],
    permissions: [],
    blockingEvents: [],
  };

  let pool: sql.ConnectionPool | null = null;
  try {
    log.info(`[instance=${instance.id}] Connecting to ${instance.host}:${instance.port} (auth=${instance.auth_type})`);
    const config = buildConnectionConfig(instance, encryptionKey);
    pool = await new sql.ConnectionPool(config).connect();
    log.info(`[instance=${instance.id}] Connected, running collectors`);
    const request = pool.request();

    // Run instance_health first — we need sqlserver_start_time for wait_stats
    const health = await collectInstanceHealth(request);
    const startTime = health[0]?.sqlserver_start_time ?? new Date();

    // Collect os_host_info and server_config on first connect only (static data)
    const needsHostInfo = !hostInfoCollected.has(instance.id);

    // Ensure the matei_blocking XE session exists before collecting blocking events
    if (isQueryStatsCycle) {
      await ensureBlockingXeSession(pool.request(), instance.id, startTime);
    }

    // Run remaining collectors (file I/O always, os_disk only every 10th cycle)
    const collectorsPromise: [
      Promise<WaitStatsDelta[] | null>,
      Promise<ActiveSessionRow[]>,
      Promise<OsCpuRow[]>,
      Promise<OsMemoryRow[]>,
      Promise<FileIoDelta[] | null>,
      Promise<OsDiskRow[]>,
      Promise<QueryStatsDelta[] | null>,
      Promise<ProcedureStatsDelta[] | null>,
      Promise<ProcedureStatementRow[]>,
      Promise<OsHostInfoRow[]>,
      Promise<ServerConfigRow[]>,
      Promise<DeadlockRow[]>,
      Promise<PerfCounterResult[] | null>,
      Promise<MemoryClerkRow[]>,
      Promise<PermissionsRow[]>,
      Promise<BlockingEventRow[]>,
    ] = [
      collectWaitStats(pool.request(), instance.id, startTime),
      collectActiveSessions(pool.request()),
      collectOsCpu(pool.request()),
      collectOsMemory(pool.request()),
      collectFileIoStats(pool.request(), instance.id, startTime),
      isDiskCycle ? collectOsDisk(pool.request()) : Promise.resolve([]),
      isQueryStatsCycle ? collectQueryStats(pool.request(), instance.id, startTime) : Promise.resolve(null),
      isQueryStatsCycle ? collectProcedureStats(pool.request(), instance.id, startTime) : Promise.resolve(null),
      isQueryStatsCycle ? collectProcedureStatements(pool.request()) : Promise.resolve([]),
      needsHostInfo ? collectOsHostInfo(pool.request()) : Promise.resolve([]),
      needsHostInfo ? collectServerConfig(pool.request()) : Promise.resolve([]),
      isQueryStatsCycle ? collectDeadlocks(pool.request(), instance.id) : Promise.resolve([]),
      collectPerfCounters(pool.request(), instance.id, startTime),
      isQueryStatsCycle ? collectMemoryClerks(pool.request()) : Promise.resolve([]),
      isPermissionsCycle ? collectPermissions(pool.request()) : Promise.resolve([]),
      isQueryStatsCycle ? collectBlockingEvents(pool.request(), instance.id, pool.request()) : Promise.resolve([]),
    ];

    const [waitStats, activeSessions, osCpu, osMemory, fileIoStats, osDisk, queryStats, procedureStats, procedureStatements, osHostInfo, serverConfig, deadlocks, perfCounters, memoryClerks, permissions, blockingEvents] = await Promise.all(collectorsPromise);

    if (needsHostInfo && osHostInfo.length > 0) {
      hostInfoCollected.add(instance.id);
    }

    log.info(`[instance=${instance.id}] Collection complete: health=${health.length} cpu=${osCpu.length} memory=${osMemory.length} sessions=${activeSessions.length} waits=${waitStats?.length ?? 'first-run'} fileio=${fileIoStats?.length ?? 'first-run'} disk=${osDisk.length} queries=${queryStats?.length ?? 'skip'} procs=${procedureStats?.length ?? 'skip'} proc_stmts=${procedureStatements.length || 'skip'} deadlocks=${deadlocks.length} blocking=${blockingEvents.length || 'skip'} perf=${perfCounters?.length ?? 'first-run'} mem_clerks=${memoryClerks.length || 'skip'} permissions=${permissions.length || 'skip'}${needsHostInfo ? ` hostinfo=${osHostInfo.length} serverconfig=${serverConfig.length}` : ''}`);

    // Collect query plans (estimated + actual) on query stats cycles — non-blocking
    if (isQueryStatsCycle && queryStats && queryStats.length > 0 && pgPool) {
      try {
        await collectAndPersistPlans(pool, pgPool, instance.id, queryStats, log);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`[instance=${instance.id}] Plan collection failed (non-fatal): ${msg}`);
      }
    }

    // Collect plans for blocking SPIDs (estimated from plan cache + actual from running)
    if (blockingEvents.length > 0 && pgPool) {
      try {
        await collectBlockingPlans(pool, pgPool, instance.id, blockingEvents, log);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`[instance=${instance.id}] Blocking plan collection failed (non-fatal): ${msg}`);
      }
    }

    return {
      instanceId: instance.id,
      success: true,
      health,
      waitStats,
      activeSessions,
      osCpu,
      osMemory,
      osDisk,
      fileIoStats,
      queryStats,
      procedureStats,
      procedureStatements,
      osHostInfo,
      serverConfig,
      deadlocks,
      perfCounters,
      memoryClerks,
      permissions,
      blockingEvents,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    log.error(`[instance=${instance.id}] Collection FAILED: ${message}`);
    if (stack) {
      log.error(`[instance=${instance.id}] Stack: ${stack}`);
    }
    return { ...empty, error: message };
  } finally {
    if (pool) {
      try { await pool.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * Collect metrics from all instances with concurrency limit,
 * then batch-insert results into PostgreSQL.
 */
export async function collectAll(
  instances: InstanceRecord[],
  pgPool: pg.Pool,
  encryptionKey: string,
  concurrency: number,
  log: CollectorLog,
): Promise<{ success: number; failed: number }> {
  cycleCount++;
  const isDiskCycle = cycleCount % 10 === 0;
  const isQueryStatsCycle = cycleCount % 2 === 0;
  const isPermissionsCycle = cycleCount === 1 || cycleCount % 2880 === 0;

  const results = await runWithConcurrency(
    instances,
    concurrency,
    (inst) => collectFromInstance(inst, encryptionKey, isDiskCycle, isQueryStatsCycle, isPermissionsCycle, log, pgPool),
  );

  // Update statuses FIRST — even if batch inserts fail, we want status to reflect reality
  await updateStatuses(pgPool, results, log);

  // Batch insert all results — wrap each in try/catch so one failure doesn't block others
  for (const [label, insertFn] of [
    ['instance_health', () => batchInsertHealth(pgPool, results)],
    ['wait_stats', () => batchInsertWaitStats(pgPool, results)],
    ['active_sessions', () => batchInsertActiveSessions(pgPool, results)],
    ['os_cpu', () => batchInsertOsCpu(pgPool, results)],
    ['os_memory', () => batchInsertOsMemory(pgPool, results)],
    ['os_disk', () => batchInsertOsDisk(pgPool, results)],
    ['file_io_stats', () => batchInsertFileIoStats(pgPool, results)],
    ['query_stats', () => batchInsertQueryStats(pgPool, results)],
    ['procedure_stats', () => batchInsertProcedureStats(pgPool, results)],
    ['procedure_statements', () => batchInsertProcedureStatements(pgPool, results)],
    ['os_host_info', () => batchInsertOsHostInfo(pgPool, results)],
    ['server_config', () => batchInsertServerConfig(pgPool, results)],
    ['deadlocks', () => batchInsertDeadlocks(pgPool, results)],
    ['perf_counters', () => batchInsertPerfCounters(pgPool, results)],
    ['memory_clerks', () => batchInsertMemoryClerks(pgPool, results)],
    ['permissions', () => batchInsertPermissions(pgPool, results)],
    ['blocking_events', () => batchInsertBlockingEvents(pgPool, results)],
  ] as const) {
    try {
      await insertFn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Batch insert to ${label} FAILED: ${message}`);
    }
  }

  // Evaluate alerts after each cycle
  for (const r of results) {
    try {
      const latestCpu = r.osCpu[0];
      const latestMemory = r.osMemory[0];
      const blockedSessions = r.activeSessions
        .filter((s) => s.blocking_session_id && s.blocking_session_id > 0 && s.wait_time_ms && s.wait_time_ms > 0)
        .map((s) => ({ session_id: s.session_id, wait_time_ms: s.wait_time_ms! }));

      const alerts = evaluateAlerts({
        instanceId: r.instanceId,
        cpu: latestCpu ? { sql_cpu_pct: latestCpu.sql_cpu_pct, other_process_cpu_pct: latestCpu.other_process_cpu_pct } : undefined,
        memory: latestMemory ? { os_available_memory_mb: latestMemory.os_available_memory_mb, sql_memory_low_notification: latestMemory.sql_memory_low_notification } : undefined,
        disk: r.osDisk.length > 0 ? r.osDisk.map((d) => ({ volume_mount_point: d.volume_mount_point, used_pct: d.used_pct })) : undefined,
        fileIo: r.fileIoStats ? r.fileIoStats.map((f) => ({ file_name: f.file_name, read_latency_ms: f.read_latency_ms, write_latency_ms: f.write_latency_ms })) : undefined,
        blocking: blockedSessions.length > 0 ? blockedSessions : undefined,
        reachable: r.success,
      });

      if (alerts.length > 0) {
        await writeAlerts(pgPool, r.instanceId, alerts);
        fireWebhook(r.instanceId, alerts, undefined, pgPool);
        log.info(`[instance=${r.instanceId}] ${alerts.length} alert(s) created`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[instance=${r.instanceId}] Alert evaluation failed: ${message}`);
    }
  }

  let success = 0;
  let failed = 0;
  for (const r of results) {
    if (r.success) success++;
    else failed++;
  }

  return { success, failed };
}

// --- Batch insert helpers ---

async function batchInsertHealth(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of results) {
    for (const row of r.health) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      values.push(
        r.instanceId, row.instance_name, row.edition, row.version,
        row.sp_level, row.major_version, row.hadr_enabled ? true : false,
        row.is_clustered ? true : false, row.sqlserver_start_time,
        row.uptime_seconds, row.cpu_count, row.hyperthread_ratio,
        row.physical_memory_mb, row.committed_mb, row.target_mb,
        row.max_workers_count, row.scheduler_count, row.collected_at_utc,
      );
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO instance_health (
      instance_id, instance_name, edition, version, sp_level, major_version,
      hadr_enabled, is_clustered, sqlserver_start_time, uptime_seconds,
      cpu_count, hyperthread_ratio, physical_memory_mb, committed_mb, target_mb,
      max_workers_count, scheduler_count, collected_at
    ) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function batchInsertWaitStats(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of results) {
    if (!r.waitStats) continue;
    for (const row of r.waitStats) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      values.push(
        r.instanceId, row.wait_type, row.waiting_tasks_count_delta,
        row.wait_time_ms_delta, row.max_wait_time_ms,
        row.signal_wait_time_ms_delta, new Date(),
      );
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO wait_stats_raw (
      instance_id, wait_type, waiting_tasks_count_delta,
      wait_time_ms_delta, max_wait_time_ms, signal_wait_time_ms_delta, collected_at
    ) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function batchInsertActiveSessions(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of results) {
    for (const row of r.activeSessions) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      values.push(
        r.instanceId, row.session_id, row.request_id, row.blocking_session_id,
        row.session_status, row.request_status, row.login_name, row.host_name,
        row.program_name, row.database_name, row.command, row.wait_type,
        row.wait_time_ms, row.wait_resource, row.elapsed_time_ms,
        row.cpu_time_ms, row.logical_reads, row.writes, row.row_count,
        row.open_transaction_count, row.isolation_level_desc,
        row.granted_memory_kb, row.current_statement, row.full_sql_text,
        row.collected_at_utc,
      );
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO active_sessions_snapshot (
      instance_id, session_id, request_id, blocking_session_id,
      session_status, request_status, login_name, host_name,
      program_name, database_name, command, wait_type,
      wait_time_ms, wait_resource, elapsed_time_ms,
      cpu_time_ms, logical_reads, writes, row_count,
      open_transaction_count, isolation_level_desc,
      granted_memory_kb, current_statement, full_sql_text, collected_at
    ) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function batchInsertOsCpu(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of results) {
    for (const row of r.osCpu) {
      placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      values.push(
        r.instanceId, row.sql_cpu_pct, row.system_idle_pct,
        row.other_process_cpu_pct, row.collected_at_utc,
      );
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO os_cpu (
      instance_id, sql_cpu_pct, system_idle_pct, other_process_cpu_pct, collected_at
    ) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function batchInsertOsMemory(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of results) {
    for (const row of r.osMemory) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      values.push(
        r.instanceId, row.os_total_memory_mb, row.os_available_memory_mb,
        row.os_used_memory_mb, row.os_memory_used_pct,
        row.os_page_file_total_mb, row.os_page_file_available_mb,
        row.system_memory_state_desc, row.sql_physical_memory_mb,
        row.sql_locked_pages_mb, row.sql_virtual_committed_mb,
        row.sql_memory_utilization_pct, row.sql_memory_low_notification ? true : false,
        row.sql_virtual_memory_low_notification ? true : false,
        row.sql_committed_mb, row.sql_target_mb, row.collected_at_utc,
      );
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO os_memory (
      instance_id, os_total_memory_mb, os_available_memory_mb,
      os_used_memory_mb, os_memory_used_pct,
      os_page_file_total_mb, os_page_file_available_mb,
      system_memory_state_desc, sql_physical_memory_mb,
      sql_locked_pages_mb, sql_virtual_committed_mb,
      sql_memory_utilization_pct, sql_memory_low_notification,
      sql_virtual_memory_low_notification,
      sql_committed_mb, sql_target_mb, collected_at
    ) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function batchInsertOsDisk(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of results) {
    for (const row of r.osDisk) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      values.push(
        r.instanceId, row.volume_mount_point, row.logical_volume_name,
        row.file_system_type, row.total_mb, row.available_mb,
        row.used_mb, row.used_pct, row.supports_compression ? true : false,
        row.is_compressed ? true : false, row.collected_at_utc,
      );
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO os_disk (
      instance_id, volume_mount_point, logical_volume_name,
      file_system_type, total_mb, available_mb,
      used_mb, used_pct, supports_compression,
      is_compressed, collected_at
    ) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function batchInsertFileIoStats(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of results) {
    if (!r.fileIoStats) continue;
    for (const row of r.fileIoStats) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      values.push(
        r.instanceId, row.database_name, row.file_name, row.file_type,
        row.num_of_reads_delta, row.num_of_bytes_read_delta,
        row.io_stall_read_ms_delta, row.num_of_writes_delta,
        row.num_of_bytes_written_delta, row.io_stall_write_ms_delta,
        row.size_on_disk_bytes, row.volume_mount_point, new Date(),
      );
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO file_io_stats (
      instance_id, database_name, file_name, file_type,
      num_of_reads_delta, num_of_bytes_read_delta,
      io_stall_read_ms_delta, num_of_writes_delta,
      num_of_bytes_written_delta, io_stall_write_ms_delta,
      size_on_disk_bytes, volume_mount_point, collected_at
    ) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function batchInsertQueryStats(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of results) {
    if (!r.queryStats) continue;
    for (const row of r.queryStats) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      values.push(
        r.instanceId, row.query_hash, row.statement_text, row.database_name,
        row.execution_count_delta, row.cpu_ms_per_sec, row.elapsed_ms_per_sec,
        row.reads_per_sec, row.writes_per_sec, row.rows_per_sec,
        row.avg_cpu_ms, row.avg_elapsed_ms, row.avg_reads, row.avg_writes,
        new Date(), row.last_grant_kb, row.last_used_grant_kb,
      );
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO query_stats_raw (
      instance_id, query_hash, statement_text, database_name,
      execution_count_delta, cpu_ms_per_sec, elapsed_ms_per_sec,
      reads_per_sec, writes_per_sec, rows_per_sec,
      avg_cpu_ms, avg_elapsed_ms, avg_reads, avg_writes, collected_at,
      last_grant_kb, last_used_grant_kb
    ) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function batchInsertProcedureStats(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of results) {
    if (!r.procedureStats) continue;
    for (const row of r.procedureStats) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      values.push(
        r.instanceId, row.database_name, row.procedure_name,
        row.execution_count_delta, row.cpu_ms_per_sec, row.elapsed_ms_per_sec,
        row.reads_per_sec, row.writes_per_sec,
        row.avg_cpu_ms, row.avg_elapsed_ms, row.avg_reads, row.avg_writes,
        new Date(),
      );
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO procedure_stats_raw (
      instance_id, database_name, procedure_name,
      execution_count_delta, cpu_ms_per_sec, elapsed_ms_per_sec,
      reads_per_sec, writes_per_sec,
      avg_cpu_ms, avg_elapsed_ms, avg_reads, avg_writes, collected_at
    ) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function batchInsertProcedureStatements(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of results) {
    for (const row of r.procedureStatements) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      values.push(
        r.instanceId, row.database_name, row.procedure_name,
        row.statement_start_offset, row.statement_text,
        row.execution_count, row.total_cpu_ms, row.total_elapsed_ms,
        row.physical_reads, row.logical_reads, row.logical_writes,
        row.avg_cpu_ms, row.avg_elapsed_ms,
        row.min_grant_kb, row.last_grant_kb, new Date(),
      );
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO procedure_statements_raw (
      instance_id, database_name, procedure_name,
      statement_start_offset, statement_text,
      execution_count, total_cpu_ms, total_elapsed_ms,
      physical_reads, logical_reads, logical_writes,
      avg_cpu_ms, avg_elapsed_ms,
      min_grant_kb, last_grant_kb, collected_at
    ) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function batchInsertOsHostInfo(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of results) {
    for (const row of r.osHostInfo) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      values.push(
        r.instanceId, row.host_platform, row.host_distribution,
        row.host_release, row.host_service_pack_level, row.host_sku,
        row.os_language_version, row.collected_at_utc,
      );
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO os_host_info (
      instance_id, host_platform, host_distribution,
      host_release, host_service_pack_level, host_sku,
      os_language_version, collected_at
    ) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function batchInsertServerConfig(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  for (const r of results) {
    for (const row of r.serverConfig) {
      await pgPool.query(
        `INSERT INTO server_config (
          instance_id, server_collation, xp_cmdshell, clr_enabled,
          external_scripts_enabled, remote_access, max_degree_of_parallelism,
          max_server_memory_mb, cost_threshold_for_parallelism, collected_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (instance_id) DO UPDATE SET
          server_collation = EXCLUDED.server_collation,
          xp_cmdshell = EXCLUDED.xp_cmdshell,
          clr_enabled = EXCLUDED.clr_enabled,
          external_scripts_enabled = EXCLUDED.external_scripts_enabled,
          remote_access = EXCLUDED.remote_access,
          max_degree_of_parallelism = EXCLUDED.max_degree_of_parallelism,
          max_server_memory_mb = EXCLUDED.max_server_memory_mb,
          cost_threshold_for_parallelism = EXCLUDED.cost_threshold_for_parallelism,
          collected_at = NOW()`,
        [
          r.instanceId, row.server_collation, row.xp_cmdshell, row.clr_enabled,
          row.external_scripts_enabled, row.remote_access, row.max_degree_of_parallelism,
          row.max_server_memory_mb, row.cost_threshold_for_parallelism,
        ],
      );
    }
  }
}

async function batchInsertDeadlocks(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of results) {
    for (const row of r.deadlocks) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      values.push(
        r.instanceId, row.deadlock_time, row.victim_spid,
        row.victim_query, row.deadlock_xml, new Date(),
      );
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO deadlocks (
      instance_id, deadlock_time, victim_spid,
      victim_query, deadlock_xml, collected_at
    ) VALUES ${placeholders.join(', ')}
    ON CONFLICT (instance_id, deadlock_time, collected_at) DO NOTHING`,
    values,
  );
}

async function batchInsertBlockingEvents(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of results) {
    for (const row of r.blockingEvents) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      values.push(
        r.instanceId, row.event_time, row.head_blocker_spid,
        row.head_blocker_login, row.head_blocker_host, row.head_blocker_app,
        row.head_blocker_db, row.head_blocker_sql,
        JSON.stringify(row.chain_json), row.total_blocked_count,
        row.max_wait_time_ms, new Date(),
      );
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO blocking_events (
      instance_id, event_time, head_blocker_spid,
      head_blocker_login, head_blocker_host, head_blocker_app,
      head_blocker_db, head_blocker_sql,
      chain_json, total_blocked_count,
      max_wait_time_ms, collected_at
    ) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function batchInsertPerfCounters(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of results) {
    if (!r.perfCounters) continue;
    for (const row of r.perfCounters) {
      placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      values.push(r.instanceId, row.counter_name, row.cntr_value, new Date());
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO perf_counters_raw (
      instance_id, counter_name, cntr_value, collected_at
    ) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function batchInsertMemoryClerks(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of results) {
    for (const row of r.memoryClerks) {
      placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      values.push(r.instanceId, row.clerk_type, row.size_mb, new Date());
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO memory_clerks_raw (
      instance_id, clerk_type, size_mb, collected_at
    ) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function batchInsertPermissions(pgPool: pg.Pool, results: InstanceResult[]): Promise<void> {
  for (const r of results) {
    if (r.permissions.length === 0) continue;

    // Full replace: delete old data then insert new snapshot
    await pgPool.query(`DELETE FROM server_role_members WHERE instance_id = $1`, [r.instanceId]);

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;

    for (const row of r.permissions) {
      placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      values.push(r.instanceId, row.role_name, row.login_name, row.login_type);
    }

    await pgPool.query(
      `INSERT INTO server_role_members (
        instance_id, role_name, login_name, login_type
      ) VALUES ${placeholders.join(', ')}`,
      values,
    );
  }
}

async function updateStatuses(pgPool: pg.Pool, results: InstanceResult[], log: CollectorLog): Promise<void> {
  for (const r of results) {
    if (r.success) {
      await pgPool.query(
        "UPDATE instances SET status = 'online', last_seen = NOW() WHERE id = $1",
        [r.instanceId],
      );
    } else {
      log.warn(`[instance=${r.instanceId}] Marking unreachable: ${r.error}`);
      await pgPool.query(
        "UPDATE instances SET status = 'unreachable' WHERE id = $1",
        [r.instanceId],
      );
    }
  }
}
