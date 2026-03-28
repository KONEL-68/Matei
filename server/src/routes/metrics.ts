import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { AppConfig } from '../config.js';
import { EXCLUDED_WAITS } from '../collector/collectors/wait-stats.js';
import { getSharedPool, type InstanceRecord } from '../lib/mssql.js';

interface IdParam {
  id: string;
}

interface RangeQuery {
  range?: '1h' | '6h' | '24h' | '7d' | '30d' | '1y';
  from?: string;
  to?: string;
}

/**
 * Resolve time filter: if from+to are provided, use them; otherwise use range preset.
 * Returns { condition, params } for SQL WHERE clause.
 * `timeCol` is the column name (e.g. 'collected_at' or 'bucket').
 * `paramOffset` is the starting $N index for params.
 */
export function resolveTimeFilter(
  query: RangeQuery,
  timeCol: string,
  paramOffset: number,
): { condition: string; params: string[]; interval: string } {
  if (query.from && query.to) {
    return {
      condition: `${timeCol} >= $${paramOffset} AND ${timeCol} <= $${paramOffset + 1}`,
      params: [query.from, query.to],
      interval: '24 hours', // fallback for tier detection
    };
  }
  const interval = rangeToInterval(query.range);
  return {
    condition: `${timeCol} > NOW() - $${paramOffset}::interval`,
    params: [interval],
    interval,
  };
}

function rangeToInterval(range: string | undefined): string {
  switch (range) {
    case '1h': return '1 hour';
    case '6h': return '6 hours';
    case '24h': return '24 hours';
    case '7d': return '7 days';
    case '30d': return '30 days';
    case '1y': return '1 year';
    default: return '1 hour';
  }
}

/** Bucket size in minutes for time-series charts. */
export function chartBucketMinutes(range: string | undefined): number {
  switch (range) {
    case '7d': return 30;
    case '24h': return 5;
    default: return 1; // 1h, 6h
  }
}

/** Determine which table tier to query based on requested time range. */
function queryTier(range: string | undefined): 'raw' | '5min' | 'hourly' {
  switch (range) {
    case '30d': return '5min';
    case '1y': return 'hourly';
    case '7d': return '5min';
    default: return 'raw';
  }
}

export async function metricRoutes(app: FastifyInstance, pool: pg.Pool, config?: AppConfig) {
  // GET /api/metrics/overview — fleet summary
  app.get('/api/metrics/overview', async (_req, reply) => {
    const instancesResult = await pool.query(
      `SELECT i.id, i.name, i.host, i.port, i.status, i.last_seen, i.is_enabled,
              i.group_id, g.name AS group_name
       FROM instances i
       LEFT JOIN instance_groups g ON g.id = i.group_id
       ORDER BY i.name`,
    );

    const instances = instancesResult.rows;
    const total = instances.length;
    const online = instances.filter((i: { status: string }) => i.status === 'online').length;
    const unreachable = instances.filter((i: { status: string }) => i.status === 'unreachable').length;

    // Enrich with latest metrics — wrapped in try/catch so instances always appear
    // even if metric tables have no data yet (first cycle) or partitions are missing
    // Only fetch metrics for enabled instances (disabled ones still appear with name+status)
    const enabledIds = instances
      .filter((i: { is_enabled: boolean }) => i.is_enabled)
      .map((i: { id: number }) => i.id);
    const instanceIds = enabledIds;
    let latestCpu: Record<number, { sql_cpu_pct: number; other_process_cpu_pct: number; system_idle_pct: number }> = {};
    let latestMemory: Record<number, { os_total_memory_mb: number; os_available_memory_mb: number; sql_committed_mb: number; sql_target_mb: number }> = {};
    let latestHealth: Record<number, { version: string; edition: string; uptime_seconds: number }> = {};
    let latestWaits: Record<number, Array<{ wait_type: string; wait_ms_per_sec: number }>> = {};
    let totalWaits: Record<number, number> = {};
    let diskIo: Record<number, number> = {};
    let alertInfo: Record<number, { alert_count: number; first_alert_message: string | null }> = {};
    let healthySince: Record<number, string | null> = {};

    if (instanceIds.length > 0) {
      try {
        const cpuResult = await pool.query(
          `SELECT DISTINCT ON (instance_id) instance_id, sql_cpu_pct, other_process_cpu_pct, system_idle_pct
           FROM os_cpu
           WHERE instance_id = ANY($1) AND collected_at > NOW() - INTERVAL '5 minutes'
           ORDER BY instance_id, collected_at DESC`,
          [instanceIds],
        );
        for (const row of cpuResult.rows) {
          latestCpu[row.instance_id] = row;
        }
      } catch { /* no cpu data yet */ }

      try {
        const memResult = await pool.query(
          `SELECT DISTINCT ON (instance_id) instance_id, os_total_memory_mb, os_available_memory_mb, sql_committed_mb, sql_target_mb
           FROM os_memory
           WHERE instance_id = ANY($1) AND collected_at > NOW() - INTERVAL '5 minutes'
           ORDER BY instance_id, collected_at DESC`,
          [instanceIds],
        );
        for (const row of memResult.rows) {
          latestMemory[row.instance_id] = row;
        }
      } catch { /* no memory data yet */ }

      try {
        const healthResult = await pool.query(
          `SELECT DISTINCT ON (instance_id) instance_id, version, edition, uptime_seconds
           FROM instance_health
           WHERE instance_id = ANY($1) AND collected_at > NOW() - INTERVAL '5 minutes'
           ORDER BY instance_id, collected_at DESC`,
          [instanceIds],
        );
        for (const row of healthResult.rows) {
          latestHealth[row.instance_id] = row;
        }
      } catch { /* no health data yet */ }

      try {
        // Get the most recent cycle's wait deltas per instance, converted to per-second rates.
        // Collection interval is 30s, so divide delta by 30.
        const COLLECTION_INTERVAL_SECONDS = 30;
        const excludedWaitsArray = [...EXCLUDED_WAITS];
        const waitsResult = await pool.query(
          `SELECT w.instance_id, w.wait_type, w.wait_time_ms_delta
           FROM wait_stats_raw w
           INNER JOIN (
             SELECT instance_id, MAX(collected_at) AS max_at
             FROM wait_stats_raw
             WHERE instance_id = ANY($1) AND collected_at > NOW() - INTERVAL '5 minutes'
             GROUP BY instance_id
           ) latest ON w.instance_id = latest.instance_id AND w.collected_at = latest.max_at
           WHERE w.wait_type != ALL($2)
           ORDER BY w.instance_id, w.wait_time_ms_delta DESC`,
          [instanceIds, excludedWaitsArray],
        );
        for (const row of waitsResult.rows) {
          const msPerSec = Number(row.wait_time_ms_delta) / COLLECTION_INTERVAL_SECONDS;
          if (!latestWaits[row.instance_id]) latestWaits[row.instance_id] = [];
          if (latestWaits[row.instance_id].length < 3) {
            latestWaits[row.instance_id].push({
              wait_type: row.wait_type,
              wait_ms_per_sec: msPerSec,
            });
          }
          totalWaits[row.instance_id] = (totalWaits[row.instance_id] ?? 0) + msPerSec;
        }
      } catch { /* no wait data yet */ }

      // Disk I/O: sum of bytes read+written per second from latest file_io_stats cycle
      try {
        const COLLECTION_INTERVAL_SECONDS = 30;
        const ioResult = await pool.query(
          `SELECT f.instance_id,
                  SUM(f.num_of_bytes_read_delta + f.num_of_bytes_written_delta) / $2::numeric / 1048576.0 AS disk_io_mb_per_sec
           FROM file_io_stats f
           INNER JOIN (
             SELECT instance_id, MAX(collected_at) AS max_at
             FROM file_io_stats
             WHERE instance_id = ANY($1) AND collected_at > NOW() - INTERVAL '5 minutes'
             GROUP BY instance_id
           ) latest ON f.instance_id = latest.instance_id AND f.collected_at = latest.max_at
           GROUP BY f.instance_id`,
          [instanceIds, COLLECTION_INTERVAL_SECONDS],
        );
        for (const row of ioResult.rows) {
          diskIo[row.instance_id] = Number(row.disk_io_mb_per_sec);
        }
      } catch { /* no file_io data yet */ }

      // Alerts: count + first message for unacknowledged alerts
      try {
        const alertResult = await pool.query(
          `SELECT instance_id,
                  COUNT(*)::int AS alert_count,
                  (array_agg(message ORDER BY created_at DESC))[1] AS first_alert_message
           FROM alerts
           WHERE instance_id = ANY($1) AND acknowledged = false
           GROUP BY instance_id`,
          [instanceIds],
        );
        for (const row of alertResult.rows) {
          alertInfo[row.instance_id] = {
            alert_count: row.alert_count,
            first_alert_message: row.first_alert_message,
          };
        }
      } catch { /* no alerts data yet */ }

      // Healthy since: last time an alert was created (if no active alerts, use last_seen)
      try {
        const healthySinceResult = await pool.query(
          `SELECT instance_id, MAX(created_at) AS last_alert_at
           FROM alerts
           WHERE instance_id = ANY($1)
           GROUP BY instance_id`,
          [instanceIds],
        );
        const lastAlertMap: Record<number, string> = {};
        for (const row of healthySinceResult.rows) {
          lastAlertMap[row.instance_id] = row.last_alert_at;
        }
        for (const id of instanceIds) {
          const hasActiveAlerts = alertInfo[id]?.alert_count > 0;
          if (!hasActiveAlerts) {
            // Healthy since = last alert resolution or last_seen if no alerts ever
            healthySince[id] = lastAlertMap[id] ?? null;
          }
        }
      } catch { /* no alerts data */ }
    }

    const instanceData = instances.map((inst: { id: number; name: string; host: string; port: number; status: string; last_seen: string | null; is_enabled: boolean; group_id: number | null; group_name: string | null }) => ({
      id: inst.id,
      name: inst.name,
      host: inst.host,
      port: inst.port,
      status: inst.status,
      last_seen: inst.last_seen,
      group_id: inst.group_id,
      group_name: inst.group_name,
      cpu: latestCpu[inst.id] ?? null,
      memory: latestMemory[inst.id] ?? null,
      health: latestHealth[inst.id] ?? null,
      top_waits: latestWaits[inst.id] ?? [],
      total_wait_ms_per_sec: totalWaits[inst.id] ?? null,
      disk_io_mb_per_sec: diskIo[inst.id] ?? null,
      alert_count: alertInfo[inst.id]?.alert_count ?? 0,
      first_alert_message: alertInfo[inst.id]?.first_alert_message ?? null,
      healthy_since: healthySince[inst.id] ?? inst.last_seen,
    }));

    return reply.send({
      total,
      online,
      offline: total - online - unreachable,
      error: unreachable,
      instances: instanceData,
    });
  });

  // GET /api/metrics/:instanceId/cpu?range=1h|6h|24h|7d|30d|1y&from=&to=
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/cpu', async (req, reply) => {
    const { id } = req.params;
    const interval = rangeToInterval(req.query.range);
    const tier = (req.query.from && req.query.to) ? 'raw' : queryTier(req.query.range);

    let result;
    if (tier === 'raw') {
      const tf = resolveTimeFilter(req.query, 'collected_at', 2);
      result = await pool.query(
        `SELECT sql_cpu_pct, other_process_cpu_pct, system_idle_pct, collected_at
         FROM os_cpu
         WHERE instance_id = $1 AND ${tf.condition}
         ORDER BY collected_at ASC`,
        [id, ...tf.params],
      );
    } else {
      const table = tier === '5min' ? 'os_cpu_5min' : 'os_cpu_hourly';
      result = await pool.query(
        `SELECT avg_sql_cpu_pct AS sql_cpu_pct, (100 - avg_system_idle_pct - avg_sql_cpu_pct)::smallint AS other_process_cpu_pct,
                avg_system_idle_pct::smallint AS system_idle_pct, bucket AS collected_at
         FROM ${table}
         WHERE instance_id = $1 AND bucket > NOW() - $2::interval
         ORDER BY bucket ASC`,
        [id, interval],
      );
    }

    return reply.send(result.rows);
  });

  // GET /api/metrics/:instanceId/memory?range=1h|6h|24h|7d|30d|1y&from=&to=
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/memory', async (req, reply) => {
    const { id } = req.params;
    const interval = rangeToInterval(req.query.range);
    const tier = (req.query.from && req.query.to) ? 'raw' : queryTier(req.query.range);

    let result;
    if (tier === 'raw') {
      const tf = resolveTimeFilter(req.query, 'collected_at', 2);
      result = await pool.query(
        `SELECT os_total_memory_mb, os_available_memory_mb, os_used_memory_mb, os_memory_used_pct,
                sql_committed_mb, sql_target_mb, collected_at
         FROM os_memory
         WHERE instance_id = $1 AND ${tf.condition}
         ORDER BY collected_at ASC`,
        [id, ...tf.params],
      );
    } else {
      const table = tier === '5min' ? 'os_memory_5min' : 'os_memory_hourly';
      result = await pool.query(
        `SELECT avg_available_memory_mb::int AS os_available_memory_mb,
                avg_sql_committed_mb::int AS sql_committed_mb,
                max_sql_committed_mb AS sql_target_mb,
                bucket AS collected_at
         FROM ${table}
         WHERE instance_id = $1 AND bucket > NOW() - $2::interval
         ORDER BY bucket ASC`,
        [id, interval],
      );
    }

    return reply.send(result.rows);
  });

  // GET /api/metrics/:instanceId/waits/latest — latest cycle's wait deltas (for live StatusBar)
  app.get<{ Params: IdParam }>('/api/metrics/:id/waits/latest', async (req, reply) => {
    const { id } = req.params;
    const excludedWaitsArray = [...EXCLUDED_WAITS];

    // Get the most recent collected_at, then fetch all waits from that cycle
    const result = await pool.query(
      `SELECT wait_type,
              waiting_tasks_count_delta AS waiting_tasks_count,
              wait_time_ms_delta AS wait_time_ms,
              max_wait_time_ms,
              signal_wait_time_ms_delta AS signal_wait_time_ms,
              EXTRACT(EPOCH FROM (collected_at - LAG(collected_at) OVER (PARTITION BY instance_id ORDER BY collected_at))) AS interval_sec
       FROM wait_stats_raw
       WHERE instance_id = $1
         AND collected_at = (SELECT MAX(collected_at) FROM wait_stats_raw WHERE instance_id = $1)
         AND wait_type != ALL($2)
         AND wait_time_ms_delta > 0
       ORDER BY wait_time_ms_delta DESC
       LIMIT 10`,
      [id, excludedWaitsArray],
    );

    // Compute ms/sec using the actual interval between this cycle and the previous one
    // Default to 30s if we can't determine the interval
    const intervalSec = result.rows[0]?.interval_sec ?? 30;
    const effectiveInterval = intervalSec > 0 ? intervalSec : 30;

    const rows = result.rows.map((row: Record<string, unknown>) => ({
      wait_type: row.wait_type,
      waiting_tasks_count: Number(row.waiting_tasks_count),
      wait_time_ms: Number(row.wait_time_ms),
      max_wait_time_ms: Number(row.max_wait_time_ms),
      signal_wait_time_ms: Number(row.signal_wait_time_ms),
      wait_ms_per_sec: Number(row.wait_time_ms) / effectiveInterval,
    }));

    return reply.send(rows);
  });

  // GET /api/metrics/:instanceId/waits?range=1h|6h|24h|7d|30d|1y&from=&to=
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/waits', async (req, reply) => {
    const { id } = req.params;
    const tier = (req.query.from && req.query.to) ? 'raw' : queryTier(req.query.range);
    const rangeSeconds: Record<string, number> = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800, '30d': 2592000, '1y': 31536000 };
    const seconds = rangeSeconds[req.query.range ?? '1h'] ?? 3600;

    const excludedWaitsArray = [...EXCLUDED_WAITS];
    let rows;
    if (tier === 'raw') {
      const tf = resolveTimeFilter(req.query, 'collected_at', 2);
      const result = await pool.query(
        `SELECT wait_type,
                SUM(waiting_tasks_count_delta) as waiting_tasks_count,
                SUM(wait_time_ms_delta) as wait_time_ms,
                MAX(max_wait_time_ms) as max_wait_time_ms,
                SUM(signal_wait_time_ms_delta) as signal_wait_time_ms
         FROM wait_stats_raw
         WHERE instance_id = $1 AND ${tf.condition}
           AND wait_type != ALL($${2 + tf.params.length})
         GROUP BY wait_type
         ORDER BY wait_time_ms DESC
         LIMIT 10`,
        [id, ...tf.params, excludedWaitsArray],
      );

      // For custom ranges, compute seconds from the actual range
      let effectiveSeconds = seconds;
      if (req.query.from && req.query.to) {
        effectiveSeconds = (new Date(req.query.to).getTime() - new Date(req.query.from).getTime()) / 1000;
        if (effectiveSeconds <= 0) effectiveSeconds = 3600;
      }

      rows = result.rows.map((row) => ({
        ...row,
        waiting_tasks_count: Number(row.waiting_tasks_count),
        wait_time_ms: Number(row.wait_time_ms),
        max_wait_time_ms: Number(row.max_wait_time_ms),
        signal_wait_time_ms: Number(row.signal_wait_time_ms),
        wait_ms_per_sec: Number(row.wait_time_ms) / effectiveSeconds,
      }));
    } else {
      const interval = rangeToInterval(req.query.range);
      const table = tier === '5min' ? 'wait_stats_5min' : 'wait_stats_hourly';
      const result = await pool.query(
        `SELECT wait_type,
                AVG(avg_wait_ms_per_sec) as avg_wait_ms_per_sec,
                MAX(max_wait_ms_per_sec) as max_wait_ms_per_sec,
                SUM(total_wait_time_ms) as wait_time_ms,
                SUM(sample_count) as waiting_tasks_count
         FROM ${table}
         WHERE instance_id = $1 AND bucket > NOW() - $2::interval
           AND wait_type != ALL($3)
         GROUP BY wait_type
         ORDER BY avg_wait_ms_per_sec DESC
         LIMIT 10`,
        [id, interval, excludedWaitsArray],
      );
      rows = result.rows.map((row) => ({
        wait_type: row.wait_type,
        waiting_tasks_count: Number(row.waiting_tasks_count),
        wait_time_ms: Number(row.wait_time_ms),
        max_wait_time_ms: Number(row.max_wait_ms_per_sec ?? 0),
        signal_wait_time_ms: 0,
        wait_ms_per_sec: Number(row.avg_wait_ms_per_sec),
      }));
    }

    return reply.send(rows);
  });

  // GET /api/metrics/:instanceId/waits/chart?range=1h|6h|24h|7d&from=&to=
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/waits/chart', async (req, reply) => {
    const { id } = req.params;
    const bucketMinutes = chartBucketMinutes(req.query.range);
    const excludedWaitsArray = [...EXCLUDED_WAITS];

    // Step 1: find top 5 wait types in range
    const tf1 = resolveTimeFilter(req.query, 'collected_at', 2);
    const topResult = await pool.query(
      `SELECT wait_type, SUM(wait_time_ms_delta) AS total
       FROM wait_stats_raw
       WHERE instance_id = $1 AND ${tf1.condition}
         AND wait_type != ALL($${2 + tf1.params.length})
       GROUP BY wait_type ORDER BY total DESC LIMIT 5`,
      [id, ...tf1.params, excludedWaitsArray],
    );
    const topTypes = topResult.rows.map((r: { wait_type: string }) => r.wait_type);
    if (topTypes.length === 0) return reply.send([]);

    // Step 2: time-bucketed series for those types
    const tf2 = resolveTimeFilter(req.query, 'collected_at', 2);
    const result = await pool.query(
      `SELECT date_trunc('minute', collected_at) -
              (EXTRACT(minute FROM collected_at)::int % $${2 + tf2.params.length}) * INTERVAL '1 minute' AS bucket,
              wait_type,
              SUM(wait_time_ms_delta)::float / ($${2 + tf2.params.length} * 60) AS wait_ms_per_sec
       FROM wait_stats_raw
       WHERE instance_id = $1 AND ${tf2.condition}
         AND wait_type = ANY($${3 + tf2.params.length})
       GROUP BY bucket, wait_type
       ORDER BY bucket ASC`,
      [id, ...tf2.params, bucketMinutes, topTypes],
    );

    return reply.send(result.rows.map((r: { bucket: string; wait_type: string; wait_ms_per_sec: number }) => ({
      bucket: new Date(r.bucket).toISOString(),
      wait_type: r.wait_type,
      wait_ms_per_sec: Number(r.wait_ms_per_sec),
    })));
  });

  // GET /api/metrics/:instanceId/waits/signal-resource-chart?range=1h|6h|24h|7d&from=&to=
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/waits/signal-resource-chart', async (req, reply) => {
    const { id } = req.params;
    const bucketMinutes = chartBucketMinutes(req.query.range);
    const excludedWaitsArray = [...EXCLUDED_WAITS];

    const tf = resolveTimeFilter(req.query, 'collected_at', 2);
    const result = await pool.query(
      `SELECT date_trunc('minute', collected_at) -
              (EXTRACT(minute FROM collected_at)::int % $${2 + tf.params.length}) * INTERVAL '1 minute' AS bucket,
              SUM(COALESCE(signal_wait_time_ms_delta, 0))::float / ($${2 + tf.params.length} * 60) AS signal_ms_per_sec,
              SUM(COALESCE(wait_time_ms_delta, 0) - COALESCE(signal_wait_time_ms_delta, 0))::float / ($${2 + tf.params.length} * 60) AS resource_ms_per_sec
       FROM wait_stats_raw
       WHERE instance_id = $1 AND ${tf.condition}
         AND wait_type != ALL($${3 + tf.params.length})
       GROUP BY bucket
       ORDER BY bucket ASC`,
      [id, ...tf.params, bucketMinutes, excludedWaitsArray],
    );

    return reply.send(result.rows.map((r: { bucket: string; signal_ms_per_sec: number; resource_ms_per_sec: number }) => ({
      bucket: new Date(r.bucket).toISOString(),
      signal_ms_per_sec: Number(r.signal_ms_per_sec),
      resource_ms_per_sec: Number(r.resource_ms_per_sec),
    })));
  });

  // GET /api/metrics/:instanceId/sessions/history?range=1h|6h|24h&from=&to=
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/sessions/history', async (req, reply) => {
    const { id } = req.params;
    const tf = resolveTimeFilter(req.query, 'collected_at', 2);

    const result = await pool.query(
      `SELECT DISTINCT collected_at
       FROM active_sessions_snapshot
       WHERE instance_id = $1 AND ${tf.condition}
       ORDER BY collected_at DESC`,
      [id, ...tf.params],
    );

    return reply.send(result.rows.map((r: { collected_at: string }) => r.collected_at));
  });

  // GET /api/metrics/:instanceId/sessions?at=<ISO timestamp>
  app.get<{ Params: IdParam; Querystring: { at?: string } }>('/api/metrics/:id/sessions', async (req, reply) => {
    const { id } = req.params;
    const at = req.query.at;

    let snapshotTime: string;

    if (at) {
      // Find exact match or closest snapshot before the given time
      const snapResult = await pool.query(
        `SELECT collected_at FROM active_sessions_snapshot
         WHERE instance_id = $1 AND collected_at <= $2
         ORDER BY collected_at DESC LIMIT 1`,
        [id, at],
      );
      if (snapResult.rows.length === 0) {
        return reply.send([]);
      }
      snapshotTime = snapResult.rows[0].collected_at;
    } else {
      // Get the latest snapshot timestamp
      const latestResult = await pool.query(
        `SELECT MAX(collected_at) as latest FROM active_sessions_snapshot WHERE instance_id = $1`,
        [id],
      );
      if (!latestResult.rows[0]?.latest) {
        return reply.send([]);
      }
      snapshotTime = latestResult.rows[0].latest;
    }

    const result = await pool.query(
      `SELECT session_id, request_id, blocking_session_id, session_status, request_status,
              login_name, host_name, program_name, database_name, command,
              wait_type, wait_time_ms, wait_resource, elapsed_time_ms, cpu_time_ms,
              logical_reads, writes, row_count, open_transaction_count,
              granted_memory_kb, current_statement, collected_at
       FROM active_sessions_snapshot
       WHERE instance_id = $1 AND collected_at = $2
       ORDER BY cpu_time_ms DESC NULLS LAST`,
      [id, snapshotTime],
    );

    return reply.send(result.rows);
  });

  // GET /api/metrics/:instanceId/health
  app.get<{ Params: IdParam }>('/api/metrics/:id/health', async (req, reply) => {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT instance_name, edition, version, sp_level, major_version,
              hadr_enabled, is_clustered, sqlserver_start_time, uptime_seconds,
              cpu_count, hyperthread_ratio, physical_memory_mb, committed_mb,
              target_mb, max_workers_count, scheduler_count, collected_at
       FROM instance_health
       WHERE instance_id = $1
       ORDER BY collected_at DESC
       LIMIT 1`,
      [id],
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'No health data found' });
    }

    // Also get OS info from the instances table
    const instanceResult = await pool.query(
      `SELECT name, host, port, status, last_seen FROM instances WHERE id = $1`,
      [id],
    );

    return reply.send({
      ...result.rows[0],
      instance: instanceResult.rows[0] ?? null,
    });
  });

  // GET /api/metrics/:instanceId/blocking-chains — build blocking trees from latest sessions
  app.get<{ Params: IdParam }>('/api/metrics/:id/blocking-chains', async (req, reply) => {
    const { id } = req.params;

    const latestResult = await pool.query(
      `SELECT MAX(collected_at) as latest FROM active_sessions_snapshot WHERE instance_id = $1`,
      [id],
    );

    if (!latestResult.rows[0]?.latest) {
      return reply.send([]);
    }

    const result = await pool.query(
      `SELECT session_id, blocking_session_id, login_name, database_name,
              wait_type, wait_time_ms, elapsed_time_ms, current_statement
       FROM active_sessions_snapshot
       WHERE instance_id = $1 AND collected_at = $2
         AND (blocking_session_id > 0 OR session_id IN (
           SELECT blocking_session_id FROM active_sessions_snapshot
           WHERE instance_id = $1 AND collected_at = $2 AND blocking_session_id > 0
         ))`,
      [id, latestResult.rows[0].latest],
    );

    return reply.send(buildBlockingTrees(result.rows));
  });

  // GET /api/metrics/:instanceId/disk?range=6h|24h|7d&from=&to= (time series) or no range (latest)
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/disk', async (req, reply) => {
    const { id } = req.params;
    const range = req.query.range;
    const hasCustomRange = req.query.from && req.query.to;

    if (hasCustomRange || (range && range !== '1h')) {
      // Time series mode: disk usage over time
      const bucketMinutes = range === '7d' ? 30 : 5;
      const tf = resolveTimeFilter(req.query, 'collected_at', 2);

      const result = await pool.query(
        `SELECT date_trunc('minute', collected_at) -
                (EXTRACT(minute FROM collected_at)::int % $${2 + tf.params.length}) * INTERVAL '1 minute' AS bucket,
                volume_mount_point,
                AVG(used_pct)::float AS used_pct
         FROM os_disk
         WHERE instance_id = $1 AND ${tf.condition}
         GROUP BY bucket, volume_mount_point
         ORDER BY bucket ASC`,
        [id, ...tf.params, bucketMinutes],
      );

      return reply.send(result.rows.map((r: { bucket: string; volume_mount_point: string; used_pct: number }) => ({
        bucket: new Date(r.bucket).toISOString(),
        volume_mount_point: r.volume_mount_point,
        used_pct: Number(r.used_pct),
      })));
    }

    // Latest snapshot (default)
    const result = await pool.query(
      `SELECT DISTINCT ON (volume_mount_point)
              volume_mount_point, logical_volume_name, file_system_type,
              total_mb, available_mb, used_mb, used_pct, collected_at
       FROM os_disk
       WHERE instance_id = $1 AND collected_at > NOW() - INTERVAL '30 minutes'
       ORDER BY volume_mount_point, collected_at DESC`,
      [id],
    );

    return reply.send(result.rows);
  });

  // GET /api/metrics/:instanceId/file-io/latest — latest cycle's file I/O latency (for live StatusBar)
  app.get<{ Params: IdParam }>('/api/metrics/:id/file-io/latest', async (req, reply) => {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT database_name, file_name, file_type,
              CASE WHEN num_of_reads_delta > 0
                   THEN io_stall_read_ms_delta::float / num_of_reads_delta ELSE 0 END AS avg_read_latency_ms,
              CASE WHEN num_of_writes_delta > 0
                   THEN io_stall_write_ms_delta::float / num_of_writes_delta ELSE 0 END AS avg_write_latency_ms
       FROM file_io_stats
       WHERE instance_id = $1
         AND collected_at = (SELECT MAX(collected_at) FROM file_io_stats WHERE instance_id = $1)
       ORDER BY (io_stall_read_ms_delta + io_stall_write_ms_delta) DESC
       LIMIT 10`,
      [id],
    );

    return reply.send(result.rows.map((r: Record<string, unknown>) => ({
      database_name: r.database_name,
      file_name: r.file_name,
      file_type: r.file_type,
      avg_read_latency_ms: Number(r.avg_read_latency_ms),
      avg_write_latency_ms: Number(r.avg_write_latency_ms),
    })));
  });

  // GET /api/metrics/:instanceId/file-io?range=1h|6h|24h|7d&from=&to=&mode=table|chart
  app.get<{ Params: IdParam; Querystring: RangeQuery & { mode?: string } }>('/api/metrics/:id/file-io', async (req, reply) => {
    const { id } = req.params;
    const mode = req.query.mode;

    if (mode === 'chart') {
      const bucketMinutes = chartBucketMinutes(req.query.range);

      // Step 1: top 5 files by total stall
      const tf1 = resolveTimeFilter(req.query, 'collected_at', 2);
      const topResult = await pool.query(
        `SELECT database_name, file_name,
                SUM(io_stall_read_ms_delta + io_stall_write_ms_delta) AS total_stall
         FROM file_io_stats
         WHERE instance_id = $1 AND ${tf1.condition}
         GROUP BY database_name, file_name
         ORDER BY total_stall DESC LIMIT 5`,
        [id, ...tf1.params],
      );
      const topFiles = topResult.rows.map((r: { database_name: string; file_name: string }) =>
        `${r.database_name}/${r.file_name}`);
      if (topFiles.length === 0) return reply.send([]);

      // Step 2: time series for those files
      const tf2 = resolveTimeFilter(req.query, 'collected_at', 2);
      const result = await pool.query(
        `SELECT date_trunc('minute', collected_at) -
                (EXTRACT(minute FROM collected_at)::int % $${2 + tf2.params.length}) * INTERVAL '1 minute' AS bucket,
                database_name || '/' || file_name AS file_key,
                CASE WHEN SUM(num_of_reads_delta) > 0
                     THEN SUM(io_stall_read_ms_delta)::float / SUM(num_of_reads_delta)
                     ELSE 0 END AS avg_read_latency_ms,
                CASE WHEN SUM(num_of_writes_delta) > 0
                     THEN SUM(io_stall_write_ms_delta)::float / SUM(num_of_writes_delta)
                     ELSE 0 END AS avg_write_latency_ms
         FROM file_io_stats
         WHERE instance_id = $1 AND ${tf2.condition}
           AND database_name || '/' || file_name = ANY($${3 + tf2.params.length})
         GROUP BY bucket, file_key
         ORDER BY bucket ASC`,
        [id, ...tf2.params, bucketMinutes, topFiles],
      );

      return reply.send(result.rows.map((r: { bucket: string; file_key: string; avg_read_latency_ms: number; avg_write_latency_ms: number }) => ({
        bucket: new Date(r.bucket).toISOString(),
        file_key: r.file_key,
        avg_read_latency_ms: Number(r.avg_read_latency_ms),
        avg_write_latency_ms: Number(r.avg_write_latency_ms),
      })));
    }

    // Default table mode
    const tf = resolveTimeFilter(req.query, 'collected_at', 2);
    const result = await pool.query(
      `SELECT database_name, file_name, file_type,
              SUM(num_of_reads_delta) AS total_reads,
              SUM(num_of_writes_delta) AS total_writes,
              CASE WHEN SUM(num_of_reads_delta) > 0
                   THEN SUM(io_stall_read_ms_delta)::float / SUM(num_of_reads_delta)
                   ELSE 0 END AS avg_read_latency_ms,
              CASE WHEN SUM(num_of_writes_delta) > 0
                   THEN SUM(io_stall_write_ms_delta)::float / SUM(num_of_writes_delta)
                   ELSE 0 END AS avg_write_latency_ms,
              SUM(num_of_bytes_read_delta) AS total_bytes_read,
              SUM(num_of_bytes_written_delta) AS total_bytes_written
       FROM file_io_stats
       WHERE instance_id = $1 AND ${tf.condition}
       GROUP BY database_name, file_name, file_type
       ORDER BY (SUM(io_stall_read_ms_delta) + SUM(io_stall_write_ms_delta)) DESC
       LIMIT 20`,
      [id, ...tf.params],
    );

    return reply.send(result.rows.map((r) => ({
      ...r,
      total_reads: Number(r.total_reads),
      total_writes: Number(r.total_writes),
      avg_read_latency_ms: Number(r.avg_read_latency_ms),
      avg_write_latency_ms: Number(r.avg_write_latency_ms),
      total_bytes_read: Number(r.total_bytes_read),
      total_bytes_written: Number(r.total_bytes_written),
    })));
  });

  // GET /api/metrics/:id/disk-usage — combined disk space + I/O per volume
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/disk-usage', async (req, reply) => {
    const { id } = req.params;

    // Step 1: latest disk space per volume (within last 30 min)
    const diskResult = await pool.query(
      `SELECT DISTINCT ON (volume_mount_point)
              volume_mount_point, logical_volume_name, total_mb, available_mb, used_mb, used_pct
       FROM os_disk
       WHERE instance_id = $1 AND collected_at > NOW() - INTERVAL '30 minutes'
       ORDER BY volume_mount_point, collected_at DESC`,
      [id],
    );

    if (diskResult.rows.length === 0) {
      return reply.send([]);
    }

    // Step 2: I/O aggregates per volume over the requested time range
    const tf = resolveTimeFilter(req.query, 'collected_at', 2);
    const ioAggResult = await pool.query(
      `SELECT
              volume_mount_point,
              CASE WHEN SUM(num_of_reads_delta) > 0
                   THEN SUM(io_stall_read_ms_delta)::float / SUM(num_of_reads_delta) ELSE 0 END AS avg_read_latency_ms,
              CASE WHEN SUM(num_of_writes_delta) > 0
                   THEN SUM(io_stall_write_ms_delta)::float / SUM(num_of_writes_delta) ELSE 0 END AS avg_write_latency_ms,
              CASE WHEN EXTRACT(EPOCH FROM (MAX(collected_at) - MIN(collected_at))) > 0
                   THEN SUM(num_of_reads_delta + num_of_writes_delta)::float /
                        EXTRACT(EPOCH FROM (MAX(collected_at) - MIN(collected_at))) ELSE 0 END AS transfers_per_sec
       FROM file_io_stats
       WHERE instance_id = $1 AND volume_mount_point IS NOT NULL AND ${tf.condition}
       GROUP BY volume_mount_point`,
      [id, ...tf.params],
    );

    const ioByVolume = new Map<string, { avg_read_latency_ms: number; avg_write_latency_ms: number; transfers_per_sec: number }>();
    for (const row of ioAggResult.rows) {
      ioByVolume.set(row.volume_mount_point, {
        avg_read_latency_ms: Number(row.avg_read_latency_ms),
        avg_write_latency_ms: Number(row.avg_write_latency_ms),
        transfers_per_sec: Number(row.transfers_per_sec),
      });
    }

    // Step 3: sparkline time series per volume (bucketed)
    const bucketMinutes = chartBucketMinutes(req.query.range);
    const tf2 = resolveTimeFilter(req.query, 'collected_at', 2);
    const sparkResult = await pool.query(
      `SELECT
              volume_mount_point,
              date_trunc('minute', collected_at) -
                (EXTRACT(MINUTE FROM collected_at)::int % $${2 + tf2.params.length}) * INTERVAL '1 minute' AS bucket,
              CASE WHEN SUM(num_of_reads_delta) > 0
                   THEN SUM(io_stall_read_ms_delta)::float / SUM(num_of_reads_delta) ELSE 0 END AS read_latency,
              CASE WHEN SUM(num_of_writes_delta) > 0
                   THEN SUM(io_stall_write_ms_delta)::float / SUM(num_of_writes_delta) ELSE 0 END AS write_latency,
              SUM(num_of_reads_delta + num_of_writes_delta)::float / ($${2 + tf2.params.length} * 60) AS transfers
       FROM file_io_stats
       WHERE instance_id = $1 AND volume_mount_point IS NOT NULL AND ${tf2.condition}
       GROUP BY volume_mount_point, bucket
       ORDER BY volume_mount_point, bucket`,
      [id, ...tf2.params, bucketMinutes],
    );

    // Group sparkline rows by volume
    const sparkByVolume = new Map<string, Array<{ t: number; read_latency: number; write_latency: number; transfers: number }>>();
    for (const row of sparkResult.rows) {
      const vol = row.volume_mount_point as string;
      if (!sparkByVolume.has(vol)) sparkByVolume.set(vol, []);
      sparkByVolume.get(vol)!.push({
        t: new Date(row.bucket).getTime(),
        read_latency: Number(row.read_latency),
        write_latency: Number(row.write_latency),
        transfers: Number(row.transfers),
      });
    }

    // Step 4: merge disk space + I/O aggregates + sparklines
    const result = diskResult.rows.map((d: {
      volume_mount_point: string;
      logical_volume_name: string;
      total_mb: number;
      available_mb: number;
      used_mb: number;
      used_pct: number;
    }) => {
      const vol = d.volume_mount_point;
      const io = ioByVolume.get(vol);
      const sparks = sparkByVolume.get(vol) ?? [];

      return {
        volume_mount_point: vol,
        logical_volume_name: d.logical_volume_name,
        total_mb: Number(d.total_mb),
        available_mb: Number(d.available_mb),
        used_mb: Number(d.used_mb),
        used_pct: Number(d.used_pct),
        avg_read_latency_ms: io?.avg_read_latency_ms ?? 0,
        avg_write_latency_ms: io?.avg_write_latency_ms ?? 0,
        transfers_per_sec: io?.transfers_per_sec ?? 0,
        sparklines: {
          read_latency: sparks.map(s => ({ t: s.t, v: s.read_latency })),
          write_latency: sparks.map(s => ({ t: s.t, v: s.write_latency })),
          transfers: sparks.map(s => ({ t: s.t, v: s.transfers })),
        },
      };
    });

    return reply.send(result);
  });

  // GET /api/metrics/:instanceId/memory/breakdown — SQL memory component breakdown (Grafana-style)
  app.get<{ Params: IdParam }>('/api/metrics/:id/memory/breakdown', async (req, reply) => {
    const { id } = req.params;

    // Try perf_counters_raw first — has all 5 values we need
    // No time filter: always return most recent value regardless of age
    const counterMap = new Map<string, number>();
    try {
      const countersResult = await pool.query(
        `SELECT DISTINCT ON (counter_name) counter_name, cntr_value
         FROM perf_counters_raw
         WHERE instance_id = $1
           AND counter_name IN (
             'Total Server Memory (KB)',
             'Target Server Memory (KB)',
             'Stolen Server Memory (KB)',
             'Database Cache Memory (KB)'
           )
         ORDER BY counter_name, collected_at DESC`,
        [id],
      );
      for (const row of countersResult.rows) {
        counterMap.set(row.counter_name, Number(row.cntr_value));
      }
    } catch { /* perf_counters_raw table may not exist yet */ }

    const totalKb = counterMap.get('Total Server Memory (KB)');
    const targetKb = counterMap.get('Target Server Memory (KB)');
    const stolenKb = counterMap.get('Stolen Server Memory (KB)');
    const dbCacheKb = counterMap.get('Database Cache Memory (KB)');

    // If perf_counters data is available, use it
    if (totalKb != null && targetKb != null) {
      const total_mb = Math.round(totalKb / 1024);
      const target_mb = Math.round(targetKb / 1024);
      return reply.send({
        total_mb,
        target_mb,
        stolen_mb: Math.round((stolenKb ?? 0) / 1024),
        database_cache_mb: Math.round((dbCacheKb ?? 0) / 1024),
        deficit_mb: total_mb - target_mb,
      });
    }

    // Fallback to os_memory table
    const memResult = await pool.query(
      `SELECT sql_committed_mb, sql_target_mb
       FROM os_memory
       WHERE instance_id = $1 AND collected_at > NOW() - INTERVAL '5 minutes'
       ORDER BY collected_at DESC LIMIT 1`,
      [id],
    );

    const mem = memResult.rows[0];
    if (!mem) {
      return reply.send(null);
    }

    const total_mb = Number(mem.sql_committed_mb);
    const target_mb = Number(mem.sql_target_mb);
    return reply.send({
      total_mb,
      target_mb,
      stolen_mb: 0,
      database_cache_mb: 0,
      deficit_mb: total_mb - target_mb,
    });
  });

  // GET /api/metrics/:instanceId/perf-counters?range=1h|6h|24h|7d&from=&to=
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/perf-counters', async (req, reply) => {
    const { id } = req.params;

    // Latest values — always return the most recent value per counter, no time filter
    const latestResult = await pool.query(
      `SELECT DISTINCT ON (counter_name) counter_name, cntr_value, collected_at
       FROM perf_counters_raw
       WHERE instance_id = $1
       ORDER BY counter_name, collected_at DESC`,
      [id],
    );

    // Time series for sparklines (bucketed by 1 minute) — uses time filter
    const tf = resolveTimeFilter(req.query, 'collected_at', 2);
    const seriesResult = await pool.query(
      `SELECT date_trunc('minute', collected_at) AS bucket,
              counter_name,
              AVG(cntr_value)::float AS cntr_value
       FROM perf_counters_raw
       WHERE instance_id = $1 AND ${tf.condition}
       GROUP BY bucket, counter_name
       ORDER BY bucket ASC`,
      [id, ...tf.params],
    );

    return reply.send({
      latest: latestResult.rows.map((r: { counter_name: string; cntr_value: string; collected_at: string }) => ({
        counter_name: r.counter_name,
        cntr_value: Number(r.cntr_value),
        collected_at: r.collected_at,
      })),
      series: seriesResult.rows.map((r: { bucket: string; counter_name: string; cntr_value: number }) => ({
        bucket: new Date(r.bucket).toISOString(),
        counter_name: r.counter_name,
        cntr_value: Number(r.cntr_value),
      })),
    });
  });

  // GET /api/metrics/:instanceId/perf-counters/debug — diagnostic info
  app.get<{ Params: IdParam }>('/api/metrics/:id/perf-counters/debug', async (req, reply) => {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT COUNT(*)::int AS total_rows,
              MAX(collected_at) AS latest_row,
              ARRAY_AGG(DISTINCT counter_name ORDER BY counter_name) AS distinct_counters
       FROM perf_counters_raw
       WHERE instance_id = $1`,
      [id],
    );

    const row = result.rows[0];
    return reply.send({
      total_rows: row?.total_rows ?? 0,
      latest_row: row?.latest_row ?? null,
      distinct_counters: row?.distinct_counters ?? [],
    });
  });

  // GET /api/metrics/:instanceId/host-info — OS host info
  app.get<{ Params: IdParam }>('/api/metrics/:id/host-info', async (req, reply) => {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT host_platform, host_distribution, host_release,
              host_service_pack_level, host_sku, os_language_version, collected_at
       FROM os_host_info
       WHERE instance_id = $1
       ORDER BY collected_at DESC
       LIMIT 1`,
      [id],
    );

    if (result.rows.length === 0) {
      return reply.send(null);
    }

    return reply.send(result.rows[0]);
  });

  // GET /api/metrics/:instanceId/overview-chart?range=1h|6h|24h|7d
  // Returns 4 time-series in one request: cpu, memory, waits, disk_io
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/overview-chart', async (req, reply) => {
    const { id } = req.params;
    const bucketMinutes = chartBucketMinutes(req.query.range);
    const tf = resolveTimeFilter(req.query, 'collected_at', 2);
    const excludedWaitsArray = [...EXCLUDED_WAITS];

    // CPU
    let cpuRows: Array<{ bucket: string; sql_cpu_pct: number }> = [];
    try {
      const r = await pool.query(
        `SELECT date_trunc('minute', collected_at) -
                (EXTRACT(minute FROM collected_at)::int % $${2 + tf.params.length}) * INTERVAL '1 minute' AS bucket,
                AVG(sql_cpu_pct) AS sql_cpu_pct
         FROM os_cpu
         WHERE instance_id = $1 AND ${tf.condition}
         GROUP BY bucket ORDER BY bucket ASC`,
        [id, ...tf.params, bucketMinutes],
      );
      cpuRows = r.rows.map((row: { bucket: string; sql_cpu_pct: number }) => ({
        bucket: new Date(row.bucket).toISOString(),
        sql_cpu_pct: Number(row.sql_cpu_pct),
      }));
    } catch { /* */ }

    // Memory (committed GB)
    let memRows: Array<{ bucket: string; committed_gb: number }> = [];
    try {
      const r = await pool.query(
        `SELECT date_trunc('minute', collected_at) -
                (EXTRACT(minute FROM collected_at)::int % $${2 + tf.params.length}) * INTERVAL '1 minute' AS bucket,
                AVG(sql_committed_mb) / 1024.0 AS committed_gb
         FROM os_memory
         WHERE instance_id = $1 AND ${tf.condition}
         GROUP BY bucket ORDER BY bucket ASC`,
        [id, ...tf.params, bucketMinutes],
      );
      memRows = r.rows.map((row: { bucket: string; committed_gb: number }) => ({
        bucket: new Date(row.bucket).toISOString(),
        committed_gb: Number(row.committed_gb),
      }));
    } catch { /* */ }

    // Total waits ms/s
    const COLLECTION_INTERVAL_SECONDS = 30;
    let waitsRows: Array<{ bucket: string; total_wait_ms_per_sec: number }> = [];
    try {
      const r = await pool.query(
        `SELECT date_trunc('minute', collected_at) -
                (EXTRACT(minute FROM collected_at)::int % $${2 + tf.params.length}) * INTERVAL '1 minute' AS bucket,
                SUM(wait_time_ms_delta) / ${COLLECTION_INTERVAL_SECONDS}::numeric AS total_wait_ms_per_sec
         FROM wait_stats_raw
         WHERE instance_id = $1 AND ${tf.condition}
           AND wait_type != ALL($${3 + tf.params.length})
         GROUP BY bucket ORDER BY bucket ASC`,
        [id, ...tf.params, bucketMinutes, excludedWaitsArray],
      );
      waitsRows = r.rows.map((row: { bucket: string; total_wait_ms_per_sec: number }) => ({
        bucket: new Date(row.bucket).toISOString(),
        total_wait_ms_per_sec: Number(row.total_wait_ms_per_sec),
      }));
    } catch { /* */ }

    // Disk I/O MB/s (read + write split)
    let ioRows: Array<{ bucket: string; disk_io_mb_per_sec: number; disk_read_mb_per_sec: number; disk_write_mb_per_sec: number }> = [];
    try {
      const r = await pool.query(
        `SELECT date_trunc('minute', collected_at) -
                (EXTRACT(minute FROM collected_at)::int % $${2 + tf.params.length}) * INTERVAL '1 minute' AS bucket,
                SUM(num_of_bytes_read_delta + num_of_bytes_written_delta) / ${COLLECTION_INTERVAL_SECONDS}::numeric / 1048576.0 AS disk_io_mb_per_sec,
                SUM(num_of_bytes_read_delta) / ${COLLECTION_INTERVAL_SECONDS}::numeric / 1048576.0 AS disk_read_mb_per_sec,
                SUM(num_of_bytes_written_delta) / ${COLLECTION_INTERVAL_SECONDS}::numeric / 1048576.0 AS disk_write_mb_per_sec
         FROM file_io_stats
         WHERE instance_id = $1 AND ${tf.condition}
         GROUP BY bucket ORDER BY bucket ASC`,
        [id, ...tf.params, bucketMinutes],
      );
      ioRows = r.rows.map((row: { bucket: string; disk_io_mb_per_sec: number; disk_read_mb_per_sec: number; disk_write_mb_per_sec: number }) => ({
        bucket: new Date(row.bucket).toISOString(),
        disk_io_mb_per_sec: Number(row.disk_io_mb_per_sec),
        disk_read_mb_per_sec: Number(row.disk_read_mb_per_sec),
        disk_write_mb_per_sec: Number(row.disk_write_mb_per_sec),
      }));
    } catch { /* */ }

    // Merge into a single time-aligned dataset
    const bucketSet = new Set<string>();
    for (const r of cpuRows) bucketSet.add(r.bucket);
    for (const r of memRows) bucketSet.add(r.bucket);
    for (const r of waitsRows) bucketSet.add(r.bucket);
    for (const r of ioRows) bucketSet.add(r.bucket);

    const cpuMap = new Map(cpuRows.map(r => [r.bucket, r.sql_cpu_pct]));
    const memMap = new Map(memRows.map(r => [r.bucket, r.committed_gb]));
    const waitsMap = new Map(waitsRows.map(r => [r.bucket, r.total_wait_ms_per_sec]));
    const ioMap = new Map(ioRows.map(r => [r.bucket, r]));

    const merged = [...bucketSet].sort().map(bucket => {
      const io = ioMap.get(bucket);
      return {
        bucket,
        cpu_pct: cpuMap.get(bucket) ?? null,
        memory_gb: memMap.get(bucket) ?? null,
        waits_ms_per_sec: waitsMap.get(bucket) ?? null,
        disk_io_mb_per_sec: io?.disk_io_mb_per_sec ?? null,
        disk_read_mb_per_sec: io?.disk_read_mb_per_sec ?? null,
        disk_write_mb_per_sec: io?.disk_write_mb_per_sec ?? null,
      };
    });

    return reply.send(merged);
  });

  // GET /api/metrics/:instanceId/server-config — read from PostgreSQL server_config table
  app.get<{ Params: IdParam }>('/api/metrics/:id/server-config', async (req, reply) => {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT server_collation, xp_cmdshell, clr_enabled, external_scripts_enabled,
              remote_access, max_degree_of_parallelism, max_server_memory_mb,
              cost_threshold_for_parallelism, collected_at
       FROM server_config
       WHERE instance_id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return reply.send(null);
    }

    return reply.send(result.rows[0]);
  });

  // GET /api/metrics/:id/permissions — server role members (latest snapshot)
  app.get<{ Params: IdParam }>('/api/metrics/:id/permissions', async (req, reply) => {
    const { id } = req.params;

    // Single query: get all rows matching the latest collected_at (subquery avoids
    // JS Date microsecond precision loss that breaks exact timestamp matching)
    const result = await pool.query(
      `SELECT role_name, login_name, login_type, collected_at
       FROM server_role_members
       WHERE instance_id = $1
         AND collected_at = (SELECT MAX(collected_at) FROM server_role_members WHERE instance_id = $1)
       ORDER BY role_name, login_type, login_name`,
      [id],
    );

    if (result.rows.length === 0) {
      return reply.send({ collected_at: null, roles: [] });
    }

    const collectedAt = result.rows[0].collected_at;

    // Group by role
    const roleMap: Record<string, { windows_logins: number; ad_accounts: number; sql_logins: number; members: Array<{ login_name: string; login_type: string }> }> = {};

    for (const row of result.rows) {
      if (!roleMap[row.role_name]) {
        roleMap[row.role_name] = { windows_logins: 0, ad_accounts: 0, sql_logins: 0, members: [] };
      }
      const role = roleMap[row.role_name];
      role.members.push({ login_name: row.login_name, login_type: row.login_type });
      if (row.login_type === 'Windows login') role.windows_logins++;
      else if (row.login_type === 'Active Directory account') role.ad_accounts++;
      else if (row.login_type === 'SQL login') role.sql_logins++;
    }

    // Return all 8 roles even if empty
    const ALL_ROLES = ['sysadmin', 'serveradmin', 'securityadmin', 'processadmin', 'setupadmin', 'bulkadmin', 'diskadmin', 'dbcreator'];
    const roles = ALL_ROLES.map(name => ({
      role_name: name,
      windows_logins: roleMap[name]?.windows_logins ?? 0,
      ad_accounts: roleMap[name]?.ad_accounts ?? 0,
      sql_logins: roleMap[name]?.sql_logins ?? 0,
      members: roleMap[name]?.members ?? [],
    }));

    return reply.send({ collected_at: collectedAt, roles });
  });

  // =====================================================================
  // Live endpoints — query SQL Server directly for Current Activity tab
  // =====================================================================

  /** Helper: get shared SQL Server connection for an instance */
  async function getLivePool(instanceId: string) {
    const instResult = await pool.query(
      'SELECT id, host, port, auth_type, encrypted_credentials FROM instances WHERE id = $1',
      [instanceId],
    );
    if (instResult.rows.length === 0) return null;
    const row = instResult.rows[0];
    const instance: InstanceRecord = {
      id: row.id,
      host: row.host,
      port: row.port,
      auth_type: row.auth_type,
      encrypted_credentials: row.encrypted_credentials ? row.encrypted_credentials.toString('utf8') : null,
    };
    const sqlPool = await getSharedPool(instance, config!.encryptionKey);
    return sqlPool;
  }

  // GET /api/metrics/:id/memory-clerks?from=&to= — memory clerks time series (>100 MB avg)
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/memory-clerks', async (req, reply) => {
    const { id } = req.params;
    const tf = resolveTimeFilter(req.query, 'collected_at', 2);

    // Step 1: find clerk types averaging >100 MB in the range
    const topResult = await pool.query(
      `SELECT clerk_type, AVG(size_mb) AS avg_mb
       FROM memory_clerks_raw
       WHERE instance_id = $1 AND ${tf.condition}
       GROUP BY clerk_type
       HAVING AVG(size_mb) > 100
       ORDER BY avg_mb DESC`,
      [id, ...tf.params],
    );
    const topTypes = topResult.rows.map((r: { clerk_type: string }) => r.clerk_type);
    if (topTypes.length === 0) return reply.send([]);

    // Step 2: time series for those types (bucketed by minute)
    const tf2 = resolveTimeFilter(req.query, 'collected_at', 2);
    const result = await pool.query(
      `SELECT date_trunc('minute', collected_at) AS bucket,
              clerk_type,
              AVG(size_mb)::float AS size_mb
       FROM memory_clerks_raw
       WHERE instance_id = $1 AND ${tf2.condition}
         AND clerk_type = ANY($${2 + tf2.params.length})
       GROUP BY bucket, clerk_type
       ORDER BY bucket ASC`,
      [id, ...tf2.params, topTypes],
    );

    return reply.send(result.rows.map((r: { bucket: string; clerk_type: string; size_mb: number }) => ({
      bucket: new Date(r.bucket).toISOString(),
      clerk_type: r.clerk_type,
      size_mb: Number(r.size_mb),
    })));
  });

  // GET /api/metrics/:id/live/sessions — live sessions from SQL Server
  app.get<{ Params: IdParam }>('/api/metrics/:id/live/sessions', async (req, reply) => {
    const { id } = req.params;
    const sqlPool = await getLivePool(id);
    if (!sqlPool) return reply.status(404).send({ error: 'Instance not found' });

    const result = await sqlPool.request().query(`
      SELECT
        s.session_id,
        r.request_id,
        r.blocking_session_id,
        s.status AS session_status,
        r.status AS request_status,
        s.login_name,
        s.host_name,
        s.program_name,
        DB_NAME(r.database_id) AS database_name,
        r.command,
        r.wait_type,
        r.wait_time AS wait_time_ms,
        r.wait_resource,
        r.total_elapsed_time AS elapsed_time_ms,
        r.cpu_time AS cpu_time_ms,
        r.logical_reads,
        r.writes,
        r.open_transaction_count,
        r.granted_query_memory AS granted_memory_kb,
        SUBSTRING(st.text, (r.statement_start_offset/2)+1,
          ((CASE r.statement_end_offset
              WHEN -1 THEN DATALENGTH(st.text)
              ELSE r.statement_end_offset
            END - r.statement_start_offset)/2)+1) AS current_statement
      FROM sys.dm_exec_sessions s
      LEFT JOIN sys.dm_exec_requests r ON s.session_id = r.session_id
      OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) st
      WHERE s.is_user_process = 1
        AND (r.session_id IS NOT NULL OR s.open_transaction_count > 0)
      ORDER BY
        CASE WHEN r.blocking_session_id > 0 THEN 0 ELSE 1 END,
        r.total_elapsed_time DESC
    `);
    return reply.send(result.recordset);
  });

  // Build excluded waits NOT IN clause once at startup
  const excludedWaitsList = [...EXCLUDED_WAITS].map((w) => `'${w.replace(/'/g, "''")}'`).join(',');

  // GET /api/metrics/:id/live/waits — live top waits from SQL Server (cumulative snapshot)
  app.get<{ Params: IdParam }>('/api/metrics/:id/live/waits', async (req, reply) => {
    const { id } = req.params;
    const sqlPool = await getLivePool(id);
    if (!sqlPool) return reply.status(404).send({ error: 'Instance not found' });

    const result = await sqlPool.request().query(`
      SELECT TOP 5
        w.wait_type,
        w.wait_time_ms,
        w.waiting_tasks_count,
        w.signal_wait_time_ms,
        DATEDIFF(SECOND, si.sqlserver_start_time, GETUTCDATE()) AS uptime_sec
      FROM sys.dm_os_wait_stats w
      CROSS JOIN sys.dm_os_sys_info si
      WHERE w.wait_time_ms > 0
        AND w.wait_type NOT IN (${excludedWaitsList})
      ORDER BY w.wait_time_ms DESC
    `);
    const rows = result.recordset.map((r: { wait_type: string; wait_time_ms: number; uptime_sec: number }) => {
      const uptimeSec = r.uptime_sec > 0 ? r.uptime_sec : 1;
      return {
        wait_type: r.wait_type,
        wait_time_ms: r.wait_time_ms,
        wait_ms_per_sec: Math.round((r.wait_time_ms / uptimeSec) * 10) / 10,
      };
    });
    return reply.send(rows);
  });

  // GET /api/metrics/:id/live/disk — live disk space from SQL Server
  app.get<{ Params: IdParam }>('/api/metrics/:id/live/disk', async (req, reply) => {
    const { id } = req.params;
    const sqlPool = await getLivePool(id);
    if (!sqlPool) return reply.status(404).send({ error: 'Instance not found' });

    const result = await sqlPool.request().query(`
      SELECT DISTINCT
        vs.volume_mount_point,
        vs.logical_volume_name,
        vs.total_bytes / 1048576 AS total_mb,
        vs.available_bytes / 1048576 AS available_mb,
        (vs.total_bytes - vs.available_bytes) / 1048576 AS used_mb,
        CAST(100.0 * (vs.total_bytes - vs.available_bytes)
          / NULLIF(vs.total_bytes, 0) AS DECIMAL(5,2)) AS used_pct
      FROM sys.master_files mf
      CROSS APPLY sys.dm_os_volume_stats(mf.database_id, mf.file_id) vs
    `);
    return reply.send(result.recordset);
  });

  // GET /api/metrics/:id/live/memory — live memory breakdown from SQL Server
  app.get<{ Params: IdParam }>('/api/metrics/:id/live/memory', async (req, reply) => {
    const { id } = req.params;
    const sqlPool = await getLivePool(id);
    if (!sqlPool) return reply.status(404).send({ error: 'Instance not found' });

    const result = await sqlPool.request().query(`
      SELECT
        si.committed_kb / 1024 AS total_mb,
        si.committed_target_kb / 1024 AS target_mb,
        (SELECT SUM(pages_kb) / 1024 FROM sys.dm_os_memory_clerks
         WHERE type IN ('MEMORYCLERK_SQLBUFFERPOOL')) AS database_cache_mb,
        (SELECT SUM(pages_kb) / 1024 FROM sys.dm_os_memory_clerks
         WHERE type NOT IN ('MEMORYCLERK_SQLBUFFERPOOL')) AS stolen_mb
      FROM sys.dm_os_sys_info si
    `);
    if (result.recordset.length === 0) return reply.send(null);
    const r = result.recordset[0];
    return reply.send({
      total_mb: r.total_mb,
      target_mb: r.target_mb,
      stolen_mb: r.stolen_mb ?? 0,
      database_cache_mb: r.database_cache_mb ?? 0,
      deficit_mb: (r.target_mb ?? 0) - (r.total_mb ?? 0),
    });
  });

  // GET /api/metrics/:id/live/memory-clerks — top 15 memory clerks from SQL Server
  app.get<{ Params: IdParam }>('/api/metrics/:id/live/memory-clerks', async (req, reply) => {
    const { id } = req.params;
    const sqlPool = await getLivePool(id);
    if (!sqlPool) return reply.status(404).send({ error: 'Instance not found' });

    const result = await sqlPool.request().query(`
      SELECT TOP 15
          type,
          SUM(pages_kb) / 1024.0 AS size_mb
      FROM sys.dm_os_memory_clerks
      GROUP BY type
      HAVING SUM(pages_kb) > 0
      ORDER BY SUM(pages_kb) DESC
    `);
    return reply.send(result.recordset);
  });
}

// --- Blocking chain tree builder ---

interface SessionNode {
  session_id: number;
  blocking_session_id: number | null;
  login_name: string;
  database_name: string;
  wait_type: string | null;
  wait_time_ms: number | null;
  elapsed_time_ms: number | null;
  current_statement: string | null;
  children: SessionNode[];
}

/** Exported for testing. */
export function buildBlockingTrees(
  rows: Array<{
    session_id: number;
    blocking_session_id: number | null;
    login_name: string;
    database_name: string;
    wait_type: string | null;
    wait_time_ms: number | null;
    elapsed_time_ms: number | null;
    current_statement: string | null;
  }>,
): SessionNode[] {
  const nodeMap = new Map<number, SessionNode>();

  for (const row of rows) {
    nodeMap.set(row.session_id, {
      session_id: row.session_id,
      blocking_session_id: row.blocking_session_id,
      login_name: row.login_name,
      database_name: row.database_name,
      wait_type: row.wait_type,
      wait_time_ms: row.wait_time_ms,
      elapsed_time_ms: row.elapsed_time_ms,
      current_statement: row.current_statement,
      children: [],
    });
  }

  // Find root blockers: walk the blocker chain for each node to find its ultimate root.
  // Use cycle detection (tortoise-and-hare style) to handle cycles safely.
  const roots: SessionNode[] = [];
  const childOf = new Map<number, number>(); // session_id -> parent session_id

  // First pass: determine parent relationships, skipping self-blocks
  for (const node of nodeMap.values()) {
    if (node.blocking_session_id && node.blocking_session_id > 0 && node.blocking_session_id !== node.session_id) {
      const parent = nodeMap.get(node.blocking_session_id);
      if (parent) {
        childOf.set(node.session_id, node.blocking_session_id);
      }
    }
  }

  // Detect cycles: for each node, walk up the chain. If we revisit a node, it's a cycle.
  // Break cycles by removing the back-edge (treating the cycle entry point as a root).
  const visited = new Set<number>();
  const inCycle = new Set<number>();

  for (const id of nodeMap.keys()) {
    if (visited.has(id)) continue;

    const path: number[] = [];
    const pathSet = new Set<number>();
    let cur: number | undefined = id;

    while (cur !== undefined && !visited.has(cur)) {
      if (pathSet.has(cur)) {
        // Found a cycle — mark all nodes in the cycle
        const cycleStart = path.indexOf(cur);
        for (let i = cycleStart; i < path.length; i++) {
          inCycle.add(path[i]);
        }
        break;
      }
      path.push(cur);
      pathSet.add(cur);
      cur = childOf.get(cur);
    }

    for (const p of path) visited.add(p);
  }

  // Break cycles by removing parent link for one node in each cycle
  for (const id of inCycle) {
    childOf.delete(id);
  }

  // Second pass: build tree using the cleaned parent relationships
  for (const [childId, parentId] of childOf.entries()) {
    const child = nodeMap.get(childId)!;
    const parent = nodeMap.get(parentId)!;
    parent.children.push(child);
  }

  // Nodes without a parent are roots
  for (const node of nodeMap.values()) {
    if (!childOf.has(node.session_id)) {
      roots.push(node);
    }
  }

  return roots;
}
