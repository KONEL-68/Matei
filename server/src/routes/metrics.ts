import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

interface IdParam {
  id: string;
}

interface RangeQuery {
  range?: '1h' | '6h' | '24h' | '7d' | '30d' | '1y';
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

/** Determine which table tier to query based on requested time range. */
function queryTier(range: string | undefined): 'raw' | '5min' | 'hourly' {
  switch (range) {
    case '30d': return '5min';
    case '1y': return 'hourly';
    case '7d': return '5min';
    default: return 'raw';
  }
}

export async function metricRoutes(app: FastifyInstance, pool: pg.Pool) {
  // GET /api/metrics/overview — fleet summary
  app.get('/api/metrics/overview', async (_req, reply) => {
    const instancesResult = await pool.query(
      `SELECT id, name, host, port, status, last_seen, is_enabled FROM instances ORDER BY name`,
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
        const waitsResult = await pool.query(
          `SELECT w.instance_id, w.wait_type, w.wait_time_ms_delta
           FROM wait_stats_raw w
           INNER JOIN (
             SELECT instance_id, MAX(collected_at) AS max_at
             FROM wait_stats_raw
             WHERE instance_id = ANY($1) AND collected_at > NOW() - INTERVAL '5 minutes'
             GROUP BY instance_id
           ) latest ON w.instance_id = latest.instance_id AND w.collected_at = latest.max_at
           ORDER BY w.instance_id, w.wait_time_ms_delta DESC`,
          [instanceIds],
        );
        for (const row of waitsResult.rows) {
          if (!latestWaits[row.instance_id]) latestWaits[row.instance_id] = [];
          if (latestWaits[row.instance_id].length < 3) {
            latestWaits[row.instance_id].push({
              wait_type: row.wait_type,
              wait_ms_per_sec: Number(row.wait_time_ms_delta) / COLLECTION_INTERVAL_SECONDS,
            });
          }
        }
      } catch { /* no wait data yet */ }
    }

    const instanceData = instances.map((inst: { id: number; name: string; host: string; port: number; status: string; last_seen: string | null; is_enabled: boolean }) => ({
      id: inst.id,
      name: inst.name,
      host: inst.host,
      port: inst.port,
      status: inst.status,
      last_seen: inst.last_seen,
      cpu: latestCpu[inst.id] ?? null,
      memory: latestMemory[inst.id] ?? null,
      health: latestHealth[inst.id] ?? null,
      top_waits: latestWaits[inst.id] ?? [],
    }));

    return reply.send({
      total,
      online,
      offline: total - online - unreachable,
      error: unreachable,
      instances: instanceData,
    });
  });

  // GET /api/metrics/:instanceId/cpu?range=1h|6h|24h|7d|30d|1y
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/cpu', async (req, reply) => {
    const { id } = req.params;
    const interval = rangeToInterval(req.query.range);
    const tier = queryTier(req.query.range);

    let result;
    if (tier === 'raw') {
      result = await pool.query(
        `SELECT sql_cpu_pct, other_process_cpu_pct, system_idle_pct, collected_at
         FROM os_cpu
         WHERE instance_id = $1 AND collected_at > NOW() - $2::interval
         ORDER BY collected_at ASC`,
        [id, interval],
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

  // GET /api/metrics/:instanceId/memory?range=1h|6h|24h|7d|30d|1y
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/memory', async (req, reply) => {
    const { id } = req.params;
    const interval = rangeToInterval(req.query.range);
    const tier = queryTier(req.query.range);

    let result;
    if (tier === 'raw') {
      result = await pool.query(
        `SELECT os_total_memory_mb, os_available_memory_mb, os_used_memory_mb, os_memory_used_pct,
                sql_committed_mb, sql_target_mb, collected_at
         FROM os_memory
         WHERE instance_id = $1 AND collected_at > NOW() - $2::interval
         ORDER BY collected_at ASC`,
        [id, interval],
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

  // GET /api/metrics/:instanceId/waits?range=1h|6h|24h|7d|30d|1y
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/waits', async (req, reply) => {
    const { id } = req.params;
    const interval = rangeToInterval(req.query.range);
    const tier = queryTier(req.query.range);
    const rangeSeconds: Record<string, number> = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800, '30d': 2592000, '1y': 31536000 };
    const seconds = rangeSeconds[req.query.range ?? '1h'] ?? 3600;

    let rows;
    if (tier === 'raw') {
      const result = await pool.query(
        `SELECT wait_type,
                SUM(waiting_tasks_count_delta) as waiting_tasks_count,
                SUM(wait_time_ms_delta) as wait_time_ms,
                MAX(max_wait_time_ms) as max_wait_time_ms,
                SUM(signal_wait_time_ms_delta) as signal_wait_time_ms
         FROM wait_stats_raw
         WHERE instance_id = $1 AND collected_at > NOW() - $2::interval
         GROUP BY wait_type
         ORDER BY wait_time_ms DESC
         LIMIT 10`,
        [id, interval],
      );
      rows = result.rows.map((row) => ({
        ...row,
        waiting_tasks_count: Number(row.waiting_tasks_count),
        wait_time_ms: Number(row.wait_time_ms),
        max_wait_time_ms: Number(row.max_wait_time_ms),
        signal_wait_time_ms: Number(row.signal_wait_time_ms),
        wait_ms_per_sec: Number(row.wait_time_ms) / seconds,
      }));
    } else {
      const table = tier === '5min' ? 'wait_stats_5min' : 'wait_stats_hourly';
      const result = await pool.query(
        `SELECT wait_type,
                AVG(avg_wait_ms_per_sec) as avg_wait_ms_per_sec,
                MAX(max_wait_ms_per_sec) as max_wait_ms_per_sec,
                SUM(total_wait_time_ms) as wait_time_ms,
                SUM(sample_count) as waiting_tasks_count
         FROM ${table}
         WHERE instance_id = $1 AND bucket > NOW() - $2::interval
         GROUP BY wait_type
         ORDER BY avg_wait_ms_per_sec DESC
         LIMIT 10`,
        [id, interval],
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

  // GET /api/metrics/:instanceId/sessions
  app.get<{ Params: IdParam }>('/api/metrics/:id/sessions', async (req, reply) => {
    const { id } = req.params;

    // Get the latest snapshot timestamp
    const latestResult = await pool.query(
      `SELECT MAX(collected_at) as latest FROM active_sessions_snapshot WHERE instance_id = $1`,
      [id],
    );

    if (!latestResult.rows[0]?.latest) {
      return reply.send([]);
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
      [id, latestResult.rows[0].latest],
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
}
