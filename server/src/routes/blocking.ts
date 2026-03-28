import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { AppConfig } from '../config.js';
import { getSharedPool, closeSharedPool, type InstanceRecord } from '../lib/mssql.js';

interface IdParam {
  id: string;
}

interface RangeQuery {
  range?: '1h' | '6h' | '24h' | '7d';
  from?: string;
  to?: string;
}

function resolveTimeFilter(
  query: RangeQuery,
  timeCol: string,
  paramOffset: number,
): { condition: string; params: string[]; } {
  if (query.from && query.to) {
    return {
      condition: `${timeCol} >= $${paramOffset} AND ${timeCol} <= $${paramOffset + 1}`,
      params: [query.from, query.to],
    };
  }
  const interval = rangeToInterval(query.range);
  return {
    condition: `${timeCol} > NOW() - $${paramOffset}::interval`,
    params: [interval],
  };
}

function rangeToInterval(range: string | undefined): string {
  switch (range) {
    case '1h': return '1 hour';
    case '6h': return '6 hours';
    case '24h': return '24 hours';
    case '7d': return '7 days';
    default: return '1 hour';
  }
}

export async function blockingRoutes(app: FastifyInstance, pool: pg.Pool, config?: AppConfig) {
  // GET /api/metrics/:id/blocking?range=1h|6h|24h|7d&from=...&to=...
  // Returns blocking events for the instance
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/blocking', async (req, reply) => {
    const { id } = req.params;
    const { condition, params } = resolveTimeFilter(req.query, 'collected_at', 2);

    // Group by blocking scenario (SPID + login + db + SQL prefix) to deduplicate
    // across collection cycles. Show first_occurrence as event_time, but use the
    // latest chain_json/wait data (most complete picture of the blocking tree).
    const result = await pool.query(
      `SELECT
              MIN(event_time) AS event_time,
              head_blocker_spid,
              head_blocker_login,
              (array_agg(head_blocker_host ORDER BY collected_at DESC))[1] AS head_blocker_host,
              (array_agg(head_blocker_app ORDER BY collected_at DESC))[1] AS head_blocker_app,
              (array_agg(head_blocker_db ORDER BY collected_at DESC))[1] AS head_blocker_db,
              (array_agg(head_blocker_sql ORDER BY collected_at DESC))[1] AS head_blocker_sql,
              (array_agg(chain_json ORDER BY collected_at DESC))[1] AS chain_json,
              MAX(total_blocked_count) AS total_blocked_count,
              MAX(max_wait_time_ms) AS max_wait_time_ms,
              MAX(collected_at) AS collected_at
       FROM blocking_events
       WHERE instance_id = $1 AND ${condition}
       GROUP BY head_blocker_spid, head_blocker_login,
                LEFT(head_blocker_sql, 100)
       ORDER BY event_time DESC
       LIMIT 200`,
      [id, ...params],
    );

    return reply.send(result.rows);
  });

  // GET /api/blocking/recent — fleet-wide recent blocking events (last hour)
  app.get('/api/blocking/recent', async (_req, reply) => {
    const result = await pool.query(
      `SELECT b.id, b.instance_id, i.name AS instance_name,
              b.event_time, b.head_blocker_spid, b.head_blocker_login,
              b.total_blocked_count, b.max_wait_time_ms, b.collected_at
       FROM blocking_events b
       JOIN instances i ON i.id = b.instance_id
       WHERE b.collected_at > NOW() - INTERVAL '1 hour'
       ORDER BY b.event_time DESC
       LIMIT 50`,
    );

    return reply.send(result.rows);
  });

  // GET /api/blocking/counts — blocking event count per instance in last hour (for dashboard badges)
  app.get('/api/blocking/counts', async (_req, reply) => {
    const result = await pool.query(
      `SELECT instance_id, COUNT(*)::int AS count
       FROM blocking_events
       WHERE collected_at > NOW() - INTERVAL '1 hour'
       GROUP BY instance_id`,
    );

    const counts: Record<number, number> = {};
    for (const row of result.rows) {
      counts[row.instance_id] = row.count;
    }
    return reply.send(counts);
  });

  // GET /api/metrics/:id/blocking/config — live query to check blocked process threshold
  app.get<{ Params: IdParam }>('/api/metrics/:id/blocking/config', async (req, reply) => {
    if (!config) {
      return reply.status(500).send({ error: 'Server configuration not available' });
    }

    const { id } = req.params;

    const instResult = await pool.query(
      'SELECT id, host, port, auth_type, encrypted_credentials FROM instances WHERE id = $1',
      [id],
    );
    if (instResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Instance not found' });
    }

    const row = instResult.rows[0];
    const instance: InstanceRecord = {
      id: row.id,
      host: row.host,
      port: row.port,
      auth_type: row.auth_type,
      encrypted_credentials: row.encrypted_credentials ? row.encrypted_credentials.toString('utf8') : null,
    };

    try {
      const sqlPool = await getSharedPool(instance, config.encryptionKey);
      const result = await sqlPool.request().query(`
        SELECT CAST(value_in_use AS INT) AS blocked_process_threshold
        FROM sys.configurations
        WHERE name = 'blocked process threshold (s)'
      `);

      const threshold = result.recordset[0]?.blocked_process_threshold ?? 0;
      return reply.send({ blocked_process_threshold: threshold });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ error: `Failed to query SQL Server: ${message}` });
    }
  });

  // GET /api/metrics/:id/blocking/plan — look up query plan for a blocking session by SQL text
  app.get<{
    Params: IdParam;
    Querystring: { sql?: string; spid?: string; type?: 'estimated' | 'actual' };
  }>('/api/metrics/:id/blocking/plan', async (req, reply) => {
    if (!config) {
      return reply.status(500).send({ error: 'Server configuration not available' });
    }

    const { id } = req.params;
    const { sql: sqlText, spid: spidStr, type: planType = 'estimated' } = req.query;

    if (!sqlText) {
      return reply.status(400).send({ error: 'Missing required query parameter: sql' });
    }
    if (!spidStr) {
      return reply.status(400).send({ error: 'Missing required query parameter: spid' });
    }

    const spid = parseInt(spidStr, 10);
    if (isNaN(spid)) {
      return reply.status(400).send({ error: 'spid must be a valid integer' });
    }

    // Truncate SQL text to first 100 chars for prefix matching
    const sqlPrefix = sqlText.substring(0, 100);

    // --- Actual plan ---
    if (planType === 'actual') {
      // Step 1: Try live actual plan via dm_exec_query_statistics_xml
      const instResult = await pool.query(
        'SELECT id, host, port, auth_type, encrypted_credentials FROM instances WHERE id = $1',
        [id],
      );
      if (instResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Instance not found' });
      }

      const row = instResult.rows[0];
      const instance: InstanceRecord = {
        id: row.id,
        host: row.host,
        port: row.port,
        auth_type: row.auth_type,
        encrypted_credentials: row.encrypted_credentials ? row.encrypted_credentials.toString('utf8') : null,
      };

      try {
        const sqlPool = await getSharedPool(instance, config.encryptionKey);
        const result = await sqlPool.request()
          .input('spid', spid)
          .query(`
            SELECT CAST(qsx.query_plan AS NVARCHAR(MAX)) AS query_plan
            FROM sys.dm_exec_query_statistics_xml(@spid) qsx
          `);

        if (result.recordset.length > 0 && result.recordset[0].query_plan) {
          return reply.send({ plan_xml: result.recordset[0].query_plan, source: 'live' });
        }
      } catch (err) {
        // dm_exec_query_statistics_xml may not be available or session may have ended
        const message = err instanceof Error ? err.message : String(err);
        req.log.warn({ instanceId: id, spid, err: message }, 'Failed to get live actual plan for blocking session');
      }

      // Step 2a: Check by SPID hash
      const spidPlanResult = await pool.query(
        `SELECT plan_xml FROM query_plans
         WHERE instance_id = $1 AND query_hash = $2 AND plan_type = 'actual'
         ORDER BY collected_at DESC LIMIT 1`,
        [id, `blocking_spid_${spid}`],
      );
      if (spidPlanResult.rows.length > 0) {
        return reply.send({ plan_xml: spidPlanResult.rows[0].plan_xml, source: 'cached' });
      }

      // Step 2b: Fall back to PostgreSQL cache — find query_hash by SQL prefix
      const hashResult = await pool.query(
        `SELECT DISTINCT query_hash FROM query_stats_raw
         WHERE instance_id = $1 AND statement_text LIKE $2
         LIMIT 1`,
        [id, sqlPrefix + '%'],
      );

      if (hashResult.rows.length > 0) {
        const queryHash = hashResult.rows[0].query_hash;
        const planResult = await pool.query(
          `SELECT plan_xml FROM query_plans
           WHERE instance_id = $1 AND query_hash = $2 AND plan_type = 'actual'
           ORDER BY collected_at DESC LIMIT 1`,
          [id, queryHash],
        );

        if (planResult.rows.length > 0) {
          return reply.send({ plan_xml: planResult.rows[0].plan_xml, source: 'cached' });
        }
      }

      return reply.status(404).send({ error: 'Plan not found' });
    }

    // --- Estimated plan ---

    // Step 1a: Check PostgreSQL — look up by blocking SPID hash (from blocking collector)
    const spidHashResult = await pool.query(
      `SELECT plan_xml FROM query_plans
       WHERE instance_id = $1 AND query_hash = $2 AND plan_type = 'estimated'
       ORDER BY collected_at DESC LIMIT 1`,
      [id, `blocking_spid_${spid}`],
    );
    if (spidHashResult.rows.length > 0) {
      return reply.send({ plan_xml: spidHashResult.rows[0].plan_xml, source: 'cached' });
    }

    // Step 1b: Check PostgreSQL — look up query_hash by SQL text prefix
    const hashResult = await pool.query(
      `SELECT DISTINCT query_hash FROM query_stats_raw
       WHERE instance_id = $1 AND statement_text LIKE $2
       LIMIT 1`,
      [id, sqlPrefix + '%'],
    );

    if (hashResult.rows.length > 0) {
      const queryHash = hashResult.rows[0].query_hash;
      const planResult = await pool.query(
        `SELECT plan_xml FROM query_plans
         WHERE instance_id = $1 AND query_hash = $2 AND plan_type = 'estimated'
         ORDER BY collected_at DESC LIMIT 1`,
        [id, queryHash],
      );

      if (planResult.rows.length > 0) {
        return reply.send({ plan_xml: planResult.rows[0].plan_xml, source: 'cached' });
      }
    }

    // Step 2: Not in PostgreSQL — try live from SQL Server
    const instResult = await pool.query(
      'SELECT id, host, port, auth_type, encrypted_credentials FROM instances WHERE id = $1',
      [id],
    );
    if (instResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Instance not found' });
    }

    const row = instResult.rows[0];
    const instance: InstanceRecord = {
      id: row.id,
      host: row.host,
      port: row.port,
      auth_type: row.auth_type,
      encrypted_credentials: row.encrypted_credentials ? row.encrypted_credentials.toString('utf8') : null,
    };

    try {
      const sqlPool = await getSharedPool(instance, config.encryptionKey);

      // Step 3: Try to get plan from the active request by SPID
      const liveResult = await sqlPool.request()
        .input('spid', spid)
        .query(`
          SELECT p.query_plan
          FROM sys.dm_exec_requests r
          CROSS APPLY sys.dm_exec_query_plan(r.plan_handle) p
          WHERE r.session_id = @spid
        `);

      if (liveResult.recordset.length > 0 && liveResult.recordset[0].query_plan) {
        return reply.send({ plan_xml: liveResult.recordset[0].query_plan, source: 'live' });
      }

      // Step 4: SPID no longer running — search plan cache by SQL text prefix
      const cacheResult = await sqlPool.request()
        .input('sql_prefix', sqlPrefix)
        .query(`
          SELECT TOP 1 p.query_plan
          FROM sys.dm_exec_query_stats qs
          CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) t
          CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) p
          WHERE t.text LIKE @sql_prefix + '%'
          ORDER BY qs.last_execution_time DESC
        `);

      if (cacheResult.recordset.length > 0 && cacheResult.recordset[0].query_plan) {
        return reply.send({ plan_xml: cacheResult.recordset[0].query_plan, source: 'live' });
      }

      return reply.status(404).send({ error: 'Plan not found' });
    } catch (err) {
      closeSharedPool(instance.id);
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ instanceId: id, spid, err: message }, 'Failed to retrieve blocking session plan');
      return reply.status(502).send({ error: `Failed to query SQL Server: ${message}` });
    }
  });
}
