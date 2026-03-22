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
import { collectOsHostInfo, type OsHostInfoRow } from './collectors/os-host-info.js';
import { collectDeadlocks, type DeadlockRow } from './collectors/deadlocks.js';
import { collectPerfCounters, type PerfCounterResult } from './collectors/perf-counters.js';
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
  osHostInfo: OsHostInfoRow[];
  deadlocks: DeadlockRow[];
  perfCounters: PerfCounterResult[] | null;
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
  log: CollectorLog,
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
    osHostInfo: [],
    deadlocks: [],
    perfCounters: null,
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

    // Collect os_host_info on first connect only (static data)
    const needsHostInfo = !hostInfoCollected.has(instance.id);

    // Run remaining collectors (file I/O always, os_disk only every 10th cycle)
    const collectorsPromise: [
      Promise<WaitStatsDelta[] | null>,
      Promise<ActiveSessionRow[]>,
      Promise<OsCpuRow[]>,
      Promise<OsMemoryRow[]>,
      Promise<FileIoDelta[] | null>,
      Promise<OsDiskRow[]>,
      Promise<QueryStatsDelta[] | null>,
      Promise<OsHostInfoRow[]>,
      Promise<DeadlockRow[]>,
      Promise<PerfCounterResult[] | null>,
    ] = [
      collectWaitStats(pool.request(), instance.id, startTime),
      collectActiveSessions(pool.request()),
      collectOsCpu(pool.request()),
      collectOsMemory(pool.request()),
      collectFileIoStats(pool.request(), instance.id, startTime),
      isDiskCycle ? collectOsDisk(pool.request()) : Promise.resolve([]),
      isQueryStatsCycle ? collectQueryStats(pool.request(), instance.id, startTime) : Promise.resolve(null),
      needsHostInfo ? collectOsHostInfo(pool.request()) : Promise.resolve([]),
      isQueryStatsCycle ? collectDeadlocks(pool.request(), instance.id) : Promise.resolve([]),
      collectPerfCounters(pool.request(), instance.id, startTime),
    ];

    const [waitStats, activeSessions, osCpu, osMemory, fileIoStats, osDisk, queryStats, osHostInfo, deadlocks, perfCounters] = await Promise.all(collectorsPromise);

    if (needsHostInfo && osHostInfo.length > 0) {
      hostInfoCollected.add(instance.id);
    }

    log.info(`[instance=${instance.id}] Collection complete: health=${health.length} cpu=${osCpu.length} memory=${osMemory.length} sessions=${activeSessions.length} waits=${waitStats?.length ?? 'first-run'} fileio=${fileIoStats?.length ?? 'first-run'} disk=${osDisk.length} queries=${queryStats?.length ?? 'skip'} deadlocks=${deadlocks.length} perf=${perfCounters?.length ?? 'first-run'}${needsHostInfo ? ` hostinfo=${osHostInfo.length}` : ''}`);

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
      osHostInfo,
      deadlocks,
      perfCounters,
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

  const results = await runWithConcurrency(
    instances,
    concurrency,
    (inst) => collectFromInstance(inst, encryptionKey, isDiskCycle, isQueryStatsCycle, log),
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
    ['os_host_info', () => batchInsertOsHostInfo(pgPool, results)],
    ['deadlocks', () => batchInsertDeadlocks(pgPool, results)],
    ['perf_counters', () => batchInsertPerfCounters(pgPool, results)],
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
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      values.push(
        r.instanceId, row.database_name, row.file_name, row.file_type,
        row.num_of_reads_delta, row.num_of_bytes_read_delta,
        row.io_stall_read_ms_delta, row.num_of_writes_delta,
        row.num_of_bytes_written_delta, row.io_stall_write_ms_delta,
        row.size_on_disk_bytes, new Date(),
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
      size_on_disk_bytes, collected_at
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
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      values.push(
        r.instanceId, row.query_hash, row.statement_text, row.database_name,
        row.execution_count_delta, row.cpu_ms_per_sec, row.elapsed_ms_per_sec,
        row.reads_per_sec, row.writes_per_sec, row.rows_per_sec,
        row.avg_cpu_ms, row.avg_elapsed_ms, row.avg_reads, row.avg_writes,
        new Date(),
      );
    }
  }

  if (placeholders.length === 0) return;

  await pgPool.query(
    `INSERT INTO query_stats_raw (
      instance_id, query_hash, statement_text, database_name,
      execution_count_delta, cpu_ms_per_sec, elapsed_ms_per_sec,
      reads_per_sec, writes_per_sec, rows_per_sec,
      avg_cpu_ms, avg_elapsed_ms, avg_reads, avg_writes, collected_at
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
