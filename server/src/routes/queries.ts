import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import sql from 'mssql';
import type { AppConfig } from '../config.js';
import { getSharedPool, closeSharedPool, type InstanceRecord } from '../lib/mssql.js';

interface IdParam {
  id: string;
}

interface HashParam {
  id: string;
  hash: string;
}

interface QueryListQuery {
  sort?: 'cpu' | 'reads' | 'duration' | 'executions';
  range?: '1h' | '6h' | '24h';
  limit?: string;
  from?: string;
  to?: string;
}

function sortColumn(sort: string | undefined): string {
  switch (sort) {
    case 'reads': return 'reads_per_sec';
    case 'duration': return 'elapsed_ms_per_sec';
    case 'executions': return 'execution_count_delta';
    default: return 'cpu_ms_per_sec';
  }
}

function rangeToInterval(range: string | undefined): string {
  switch (range) {
    case '6h': return '6 hours';
    case '24h': return '24 hours';
    default: return '1 hour';
  }
}

export async function queryRoutes(app: FastifyInstance, pool: pg.Pool, config: AppConfig) {
  // GET /api/queries/:instanceId?sort=cpu|reads|duration|executions&range=1h|6h|24h&limit=50
  app.get<{ Params: IdParam; Querystring: QueryListQuery }>('/api/queries/:id', async (req, reply) => {
    const { id } = req.params;
    const orderBy = sortColumn(req.query.sort);
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 200);

    let timeCondition: string;
    const params: (string | number)[] = [id];

    if (req.query.from && req.query.to) {
      timeCondition = `collected_at >= $2 AND collected_at <= $3`;
      params.push(req.query.from, req.query.to);
    } else {
      const interval = rangeToInterval(req.query.range);
      timeCondition = `collected_at > NOW() - $2::interval`;
      params.push(interval);
    }

    const limitIdx = params.length + 1;
    params.push(limit);

    const result = await pool.query(
      `SELECT
         query_hash,
         MAX(statement_text) AS statement_text,
         MAX(database_name) AS database_name,
         SUM(execution_count_delta) AS execution_count,
         AVG(cpu_ms_per_sec) AS cpu_ms_per_sec,
         AVG(elapsed_ms_per_sec) AS elapsed_ms_per_sec,
         AVG(reads_per_sec) AS reads_per_sec,
         AVG(writes_per_sec) AS writes_per_sec,
         AVG(avg_cpu_ms) AS avg_cpu_ms,
         AVG(avg_elapsed_ms) AS avg_elapsed_ms,
         AVG(avg_reads) AS avg_reads,
         AVG(avg_writes) AS avg_writes,
         SUM(execution_count_delta * COALESCE(avg_cpu_ms, 0)) AS total_cpu_ms,
         SUM(execution_count_delta * COALESCE(avg_elapsed_ms, 0)) AS total_elapsed_ms,
         SUM(execution_count_delta * COALESCE(avg_reads, 0)) AS total_reads,
         SUM(execution_count_delta * COALESCE(avg_writes, 0)) AS total_writes,
         COUNT(*) AS sample_count,
         MAX(last_grant_kb) AS last_grant_kb,
         MAX(last_used_grant_kb) AS last_used_grant_kb
       FROM query_stats_raw
       WHERE instance_id = $1 AND ${timeCondition}
       GROUP BY query_hash
       ORDER BY ${orderBy} DESC
       LIMIT $${limitIdx}`,
      params,
    );

    const rows = result.rows.map((row) => ({
      query_hash: row.query_hash,
      statement_text: row.statement_text,
      database_name: row.database_name,
      execution_count: Number(row.execution_count),
      cpu_ms_per_sec: Number(row.cpu_ms_per_sec),
      elapsed_ms_per_sec: Number(row.elapsed_ms_per_sec),
      reads_per_sec: Number(row.reads_per_sec),
      writes_per_sec: Number(row.writes_per_sec),
      avg_cpu_ms: Number(row.avg_cpu_ms),
      avg_elapsed_ms: Number(row.avg_elapsed_ms),
      avg_reads: Number(row.avg_reads),
      avg_writes: Number(row.avg_writes),
      total_cpu_ms: Number(row.total_cpu_ms),
      total_elapsed_ms: Number(row.total_elapsed_ms),
      total_reads: Number(row.total_reads),
      total_writes: Number(row.total_writes),
      sample_count: Number(row.sample_count),
      last_grant_kb: row.last_grant_kb != null ? Number(row.last_grant_kb) : null,
      last_used_grant_kb: row.last_used_grant_kb != null ? Number(row.last_used_grant_kb) : null,
    }));

    return reply.send(rows);
  });

  // GET /api/queries/:instanceId/procedures — live procedure stats from SQL Server
  app.get<{ Params: IdParam; Querystring: { limit?: string } }>('/api/queries/:id/procedures', async (req, reply) => {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 200);

    const instanceResult = await pool.query(
      'SELECT id, host, port, auth_type, encrypted_credentials FROM instances WHERE id = $1',
      [id],
    );
    if (instanceResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Instance not found' });
    }

    const row = instanceResult.rows[0];
    const instance: InstanceRecord = {
      id: row.id,
      host: row.host,
      port: row.port,
      auth_type: row.auth_type,
      encrypted_credentials: row.encrypted_credentials ? row.encrypted_credentials.toString('utf8') : null,
    };

    try {
      const sqlPool = await getSharedPool(instance, config.encryptionKey);

      // CTE aggregates on integer keys first (fast), then resolves names only for TOP N
      const result = await sqlPool.request().query(`
        ;WITH agg AS (
          SELECT TOP ${limit}
              database_id,
              object_id,
              SUM(execution_count) AS execution_count,
              SUM(total_worker_time) / 1000 AS total_cpu_ms,
              SUM(total_elapsed_time) / 1000 AS total_elapsed_ms,
              SUM(total_logical_reads) AS total_reads,
              SUM(total_logical_writes) AS total_writes,
              SUM(total_worker_time) AS _sort_cpu,
              SUM(execution_count) AS _sort_exec,
              SUM(total_logical_reads) AS _sort_reads,
              MAX(last_execution_time) AS last_execution_time
          FROM sys.dm_exec_procedure_stats
          WHERE database_id > 4
          GROUP BY database_id, object_id
          HAVING OBJECT_NAME(object_id, database_id) IS NOT NULL
          ORDER BY SUM(total_worker_time) DESC
        )
        SELECT
            ISNULL(DB_NAME(database_id), '?') AS database_name,
            ISNULL(OBJECT_SCHEMA_NAME(object_id, database_id), 'dbo') + '.' + OBJECT_NAME(object_id, database_id) AS procedure_name,
            execution_count,
            total_cpu_ms,
            total_elapsed_ms,
            total_reads,
            total_writes,
            CASE WHEN _sort_exec > 0
                 THEN _sort_cpu / 1000.0 / _sort_exec ELSE 0 END AS avg_cpu_ms,
            CASE WHEN _sort_exec > 0
                 THEN total_elapsed_ms * 1.0 / _sort_exec ELSE 0 END AS avg_elapsed_ms,
            CASE WHEN _sort_exec > 0
                 THEN _sort_reads * 1.0 / _sort_exec ELSE 0 END AS avg_reads,
            last_execution_time
        FROM agg
        ORDER BY total_cpu_ms DESC
      `);

      return reply.send(result.recordset);
    } catch (err) {
      closeSharedPool(instance.id);
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: `Failed to retrieve procedures: ${message}` });
    }
  });

  // GET /api/queries/:instanceId/procedure-stats — aggregated procedure stats from PostgreSQL
  app.get<{ Params: IdParam; Querystring: QueryListQuery }>('/api/queries/:id/procedure-stats', async (req, reply) => {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 200);

    let timeCondition: string;
    const params: (string | number)[] = [id];

    if (req.query.from && req.query.to) {
      timeCondition = `collected_at >= $2 AND collected_at <= $3`;
      params.push(req.query.from, req.query.to);
    } else {
      const interval = rangeToInterval(req.query.range);
      timeCondition = `collected_at > NOW() - $2::interval`;
      params.push(interval);
    }

    const limitIdx = params.length + 1;
    params.push(limit);

    const orderBy = sortColumn(req.query.sort);

    const result = await pool.query(
      `SELECT
         database_name,
         procedure_name,
         SUM(execution_count_delta) AS execution_count,
         AVG(cpu_ms_per_sec) AS cpu_ms_per_sec,
         AVG(elapsed_ms_per_sec) AS elapsed_ms_per_sec,
         AVG(reads_per_sec) AS reads_per_sec,
         AVG(writes_per_sec) AS writes_per_sec,
         AVG(avg_cpu_ms) AS avg_cpu_ms,
         AVG(avg_elapsed_ms) AS avg_elapsed_ms,
         AVG(avg_reads) AS avg_reads,
         AVG(avg_writes) AS avg_writes,
         SUM(execution_count_delta * COALESCE(avg_cpu_ms, 0)) AS total_cpu_ms,
         SUM(execution_count_delta * COALESCE(avg_elapsed_ms, 0)) AS total_elapsed_ms,
         SUM(execution_count_delta * COALESCE(avg_reads, 0)) AS total_reads,
         SUM(execution_count_delta * COALESCE(avg_writes, 0)) AS total_writes,
         COUNT(*) AS sample_count
       FROM procedure_stats_raw
       WHERE instance_id = $1 AND ${timeCondition}
       GROUP BY database_name, procedure_name
       ORDER BY ${orderBy} DESC
       LIMIT $${limitIdx}`,
      params,
    );

    const rows = result.rows.map((row) => ({
      database_name: row.database_name,
      procedure_name: row.procedure_name,
      execution_count: Number(row.execution_count),
      cpu_ms_per_sec: Number(row.cpu_ms_per_sec),
      elapsed_ms_per_sec: Number(row.elapsed_ms_per_sec),
      reads_per_sec: Number(row.reads_per_sec),
      writes_per_sec: Number(row.writes_per_sec),
      avg_cpu_ms: Number(row.avg_cpu_ms),
      avg_elapsed_ms: Number(row.avg_elapsed_ms),
      avg_reads: Number(row.avg_reads),
      avg_writes: Number(row.avg_writes),
      total_cpu_ms: Number(row.total_cpu_ms),
      total_elapsed_ms: Number(row.total_elapsed_ms),
      total_reads: Number(row.total_reads),
      total_writes: Number(row.total_writes),
      sample_count: Number(row.sample_count),
    }));

    return reply.send(rows);
  });

  // GET /api/queries/:instanceId/procedure-statements?db=MyDb&proc=dbo.MyProc
  // Live query to get top statements within a specific stored procedure
  app.get<{ Params: IdParam; Querystring: { db?: string; proc?: string } }>('/api/queries/:id/procedure-statements', async (req, reply) => {
    const { id } = req.params;
    const dbName = req.query.db;
    const procName = req.query.proc;

    if (!dbName || !procName) {
      return reply.status(400).send({ error: 'Both "db" and "proc" query parameters are required' });
    }

    const instanceResult = await pool.query(
      'SELECT id, host, port, auth_type, encrypted_credentials FROM instances WHERE id = $1',
      [id],
    );
    if (instanceResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Instance not found' });
    }

    const row = instanceResult.rows[0];
    const instance: InstanceRecord = {
      id: row.id,
      host: row.host,
      port: row.port,
      auth_type: row.auth_type,
      encrypted_credentials: row.encrypted_credentials ? row.encrypted_credentials.toString('utf8') : null,
    };

    try {
      const sqlPool = await getSharedPool(instance, config.encryptionKey);

      // Build 3-part name for OBJECT_ID so it resolves in the correct database context
      // procName is already schema-qualified (e.g. "dbo.MyProc"), so we prepend dbName
      const qualifiedName = `${dbName}.${procName}`;

      const result = await sqlPool.request()
        .input('qualifiedName', sql.NVarChar, qualifiedName)
        .input('dbName', sql.NVarChar, dbName)
        .query(`
          SELECT
              qs.statement_start_offset,
              SUBSTRING(qt.text, (qs.statement_start_offset/2) + 1,
                  ((CASE qs.statement_end_offset
                      WHEN -1 THEN DATALENGTH(qt.text)
                      ELSE qs.statement_end_offset END
                      - qs.statement_start_offset)/2) + 1) AS statement_text,
              qs.execution_count,
              qs.total_worker_time / 1000 AS total_cpu_ms,
              qs.total_elapsed_time / 1000 AS total_elapsed_ms,
              qs.total_physical_reads AS physical_reads,
              qs.total_logical_reads AS logical_reads,
              qs.total_logical_writes AS logical_writes,
              CASE WHEN qs.execution_count > 0
                   THEN qs.total_worker_time / 1000.0 / qs.execution_count ELSE 0 END AS avg_cpu_ms,
              CASE WHEN qs.execution_count > 0
                   THEN qs.total_elapsed_time / 1000.0 / qs.execution_count ELSE 0 END AS avg_elapsed_ms,
              qs.last_execution_time,
              qs.min_grant_kb,
              qs.last_grant_kb
          FROM sys.dm_exec_query_stats qs
          CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
          WHERE qt.objectid = OBJECT_ID(@qualifiedName)
            AND qt.dbid = DB_ID(@dbName)
          ORDER BY qs.statement_start_offset ASC
        `);

      return reply.send(result.recordset);
    } catch (err) {
      closeSharedPool(instance.id);
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: `Failed to retrieve procedure statements: ${message}` });
    }
  });

  // GET /api/queries/:instanceId/procedure-statements-history — aggregated procedure statements from PostgreSQL
  app.get<{ Params: IdParam; Querystring: { db?: string; proc?: string; from?: string; to?: string } }>('/api/queries/:id/procedure-statements-history', async (req, reply) => {
    const { id } = req.params;
    const dbName = req.query.db;
    const procName = req.query.proc;

    if (!dbName || !procName) {
      return reply.status(400).send({ error: 'Both "db" and "proc" query parameters are required' });
    }

    const from = req.query.from;
    const to = req.query.to;

    if (!from || !to) {
      return reply.status(400).send({ error: 'Both "from" and "to" query parameters are required' });
    }

    const result = await pool.query(
      `SELECT
         statement_start_offset,
         statement_text,
         AVG(execution_count) AS execution_count,
         AVG(total_cpu_ms) AS total_cpu_ms,
         AVG(total_elapsed_ms) AS total_elapsed_ms,
         AVG(physical_reads) AS physical_reads,
         AVG(logical_reads) AS logical_reads,
         AVG(logical_writes) AS logical_writes,
         AVG(avg_cpu_ms) AS avg_cpu_ms,
         AVG(avg_elapsed_ms) AS avg_elapsed_ms,
         AVG(min_grant_kb) AS min_grant_kb,
         AVG(last_grant_kb) AS last_grant_kb
       FROM procedure_statements_raw
       WHERE instance_id = $1
         AND database_name = $2
         AND procedure_name = $3
         AND collected_at BETWEEN $4 AND $5
       GROUP BY statement_start_offset, statement_text
       ORDER BY statement_start_offset ASC`,
      [id, dbName, procName, from, to],
    );

    const rows = result.rows.map((row) => ({
      statement_start_offset: Number(row.statement_start_offset),
      statement_text: row.statement_text,
      execution_count: Number(row.execution_count),
      total_cpu_ms: Number(row.total_cpu_ms),
      total_elapsed_ms: Number(row.total_elapsed_ms),
      physical_reads: Number(row.physical_reads),
      logical_reads: Number(row.logical_reads),
      logical_writes: Number(row.logical_writes),
      avg_cpu_ms: Number(row.avg_cpu_ms),
      avg_elapsed_ms: Number(row.avg_elapsed_ms),
      min_grant_kb: row.min_grant_kb != null ? Number(row.min_grant_kb) : null,
      last_grant_kb: row.last_grant_kb != null ? Number(row.last_grant_kb) : null,
    }));

    return reply.send(rows);
  });

  // GET /api/queries/:instanceId/tracked — list tracked queries with their latest stats
  app.get<{ Params: IdParam; Querystring: { range?: string; from?: string; to?: string } }>('/api/queries/:id/tracked', async (req, reply) => {
    const { id } = req.params;

    let timeCondition: string;
    const params: (string | number)[] = [id];

    if (req.query.from && req.query.to) {
      timeCondition = `qs.collected_at >= $2 AND qs.collected_at <= $3`;
      params.push(req.query.from, req.query.to);
    } else {
      const interval = rangeToInterval(req.query.range);
      timeCondition = `qs.collected_at > NOW() - $2::interval`;
      params.push(interval);
    }

    const result = await pool.query(
      `SELECT
         tq.query_hash,
         tq.label,
         COALESCE(tq.statement_text, MAX(qs.statement_text)) AS statement_text,
         COALESCE(tq.database_name, MAX(qs.database_name)) AS database_name,
         tq.tracked_at,
         tq.tracked_by,
         COALESCE(SUM(qs.execution_count_delta), 0) AS execution_count,
         COALESCE(AVG(qs.cpu_ms_per_sec), 0) AS cpu_ms_per_sec,
         COALESCE(AVG(qs.elapsed_ms_per_sec), 0) AS elapsed_ms_per_sec,
         COALESCE(AVG(qs.reads_per_sec), 0) AS reads_per_sec,
         COALESCE(AVG(qs.writes_per_sec), 0) AS writes_per_sec,
         COALESCE(AVG(qs.avg_cpu_ms), 0) AS avg_cpu_ms,
         COALESCE(AVG(qs.avg_elapsed_ms), 0) AS avg_elapsed_ms,
         COALESCE(AVG(qs.avg_reads), 0) AS avg_reads,
         COALESCE(AVG(qs.avg_writes), 0) AS avg_writes,
         COALESCE(SUM(qs.execution_count_delta * COALESCE(qs.avg_cpu_ms, 0)), 0) AS total_cpu_ms,
         COALESCE(SUM(qs.execution_count_delta * COALESCE(qs.avg_elapsed_ms, 0)), 0) AS total_elapsed_ms,
         COALESCE(SUM(qs.execution_count_delta * COALESCE(qs.avg_reads, 0)), 0) AS total_reads,
         COALESCE(SUM(qs.execution_count_delta * COALESCE(qs.avg_writes, 0)), 0) AS total_writes,
         COUNT(qs.id) AS sample_count,
         MAX(qs.last_grant_kb) AS last_grant_kb,
         MAX(qs.last_used_grant_kb) AS last_used_grant_kb
       FROM tracked_queries tq
       LEFT JOIN query_stats_raw qs ON qs.instance_id = tq.instance_id AND qs.query_hash = tq.query_hash AND ${timeCondition}
       WHERE tq.instance_id = $1
       GROUP BY tq.query_hash, tq.label, tq.statement_text, tq.database_name, tq.tracked_at, tq.tracked_by
       ORDER BY total_cpu_ms DESC`,
      params,
    );

    const rows = result.rows.map((row) => ({
      query_hash: row.query_hash,
      label: row.label,
      statement_text: row.statement_text,
      database_name: row.database_name,
      tracked_at: row.tracked_at,
      tracked_by: row.tracked_by,
      execution_count: Number(row.execution_count),
      cpu_ms_per_sec: Number(row.cpu_ms_per_sec),
      elapsed_ms_per_sec: Number(row.elapsed_ms_per_sec),
      reads_per_sec: Number(row.reads_per_sec),
      writes_per_sec: Number(row.writes_per_sec),
      avg_cpu_ms: Number(row.avg_cpu_ms),
      avg_elapsed_ms: Number(row.avg_elapsed_ms),
      avg_reads: Number(row.avg_reads),
      avg_writes: Number(row.avg_writes),
      total_cpu_ms: Number(row.total_cpu_ms),
      total_elapsed_ms: Number(row.total_elapsed_ms),
      total_reads: Number(row.total_reads),
      total_writes: Number(row.total_writes),
      sample_count: Number(row.sample_count),
      last_grant_kb: row.last_grant_kb != null ? Number(row.last_grant_kb) : null,
      last_used_grant_kb: row.last_used_grant_kb != null ? Number(row.last_used_grant_kb) : null,
    }));

    return reply.send(rows);
  });

  // POST /api/queries/:instanceId/tracked — track a query
  app.post<{ Params: IdParam; Body: { query_hash: string; label?: string; statement_text?: string; database_name?: string } }>('/api/queries/:id/tracked', async (req, reply) => {
    const { id } = req.params;
    const { query_hash, label, statement_text, database_name } = req.body;

    if (!query_hash) {
      return reply.status(400).send({ error: 'query_hash is required' });
    }

    const username = (req as any).user?.username ?? null;

    await pool.query(
      `INSERT INTO tracked_queries (instance_id, query_hash, label, statement_text, database_name, tracked_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (instance_id, query_hash) DO UPDATE SET label = COALESCE($3, tracked_queries.label)`,
      [id, query_hash, label ?? null, statement_text ?? null, database_name ?? null, username],
    );

    return reply.status(201).send({ ok: true });
  });

  // DELETE /api/queries/:instanceId/tracked/:queryHash — untrack a query
  app.delete<{ Params: HashParam }>('/api/queries/:id/tracked/:hash', async (req, reply) => {
    const { id, hash } = req.params;

    const result = await pool.query(
      'DELETE FROM tracked_queries WHERE instance_id = $1 AND query_hash = $2',
      [id, hash],
    );

    if (result.rowCount === 0) {
      return reply.status(404).send({ error: 'Tracked query not found' });
    }

    return reply.send({ ok: true });
  });

  // GET /api/queries/:instanceId/:queryHash — time series for a specific query
  app.get<{ Params: HashParam; Querystring: { range?: string } }>('/api/queries/:id/:hash', async (req, reply) => {
    const { id, hash } = req.params;
    const interval = rangeToInterval(req.query.range);

    const result = await pool.query(
      `SELECT cpu_ms_per_sec, elapsed_ms_per_sec, reads_per_sec,
              execution_count_delta, avg_cpu_ms, avg_reads, collected_at
       FROM query_stats_raw
       WHERE instance_id = $1 AND query_hash = $2 AND collected_at > NOW() - $3::interval
       ORDER BY collected_at ASC`,
      [id, hash, interval],
    );

    return reply.send(result.rows);
  });

  // Helper: get shared SQL Server connection for an instance
  async function getSqlConnection(instanceId: string): Promise<{ instance: InstanceRecord; sqlPool: sql.ConnectionPool } | null> {
    const instanceResult = await pool.query(
      'SELECT id, host, port, auth_type, encrypted_credentials FROM instances WHERE id = $1',
      [instanceId],
    );
    if (instanceResult.rows.length === 0) return null;

    const row = instanceResult.rows[0];
    const instance: InstanceRecord = {
      id: row.id,
      host: row.host,
      port: row.port,
      auth_type: row.auth_type,
      encrypted_credentials: row.encrypted_credentials ? row.encrypted_credentials.toString('utf8') : null,
    };

    const sqlPool = await getSharedPool(instance, config.encryptionKey);
    return { instance, sqlPool };
  }

  // Helper: save plan to PostgreSQL (dedup by plan_hash)
  async function savePlan(instanceId: string, queryHash: string, planType: string, planXml: string): Promise<void> {
    const planHash = crypto.createHash('md5').update(planXml).digest('hex');
    await pool.query(
      `INSERT INTO query_plans (instance_id, query_hash, plan_hash, plan_type, plan_xml)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (instance_id, query_hash, plan_hash, plan_type) DO UPDATE SET collected_at = NOW()`,
      [instanceId, queryHash, planHash, planType, planXml],
    );
  }

  // Helper: get latest stored plan from PostgreSQL
  async function getStoredPlan(instanceId: string, queryHash: string, planType: string): Promise<string | null> {
    const result = await pool.query(
      `SELECT plan_xml FROM query_plans
       WHERE instance_id = $1 AND query_hash = $2 AND plan_type = $3
       ORDER BY collected_at DESC LIMIT 1`,
      [instanceId, queryHash, planType],
    );
    return result.rows[0]?.plan_xml ?? null;
  }

  // GET /api/queries/:instanceId/:queryHash/plan — estimated plan (fetch from SQL Server, cache in PostgreSQL)
  app.get<{ Params: HashParam; Querystring: { force?: string } }>('/api/queries/:id/:hash/plan', async (req, reply) => {
    const { id, hash } = req.params;
    const force = req.query.force === 'true';

    // Check stored plan first (unless forced refresh)
    if (!force) {
      const stored = await getStoredPlan(id, hash, 'estimated');
      if (stored) {
        return reply.send({ plan: stored, source: 'cached' });
      }
    }

    // Fetch from SQL Server
    const conn = await getSqlConnection(id);
    if (!conn) return reply.status(404).send({ error: 'Instance not found' });

    try {
      const planResult = await conn.sqlPool.request().query(`
        SELECT TOP 1
          qp.query_plan
        FROM sys.dm_exec_query_stats qs
        CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
        WHERE CONVERT(VARCHAR(100), qs.query_hash, 1) = '${hash.replace(/'/g, "''")}'
      `);

      if (planResult.recordset.length === 0) {
        // No live plan — return stored if exists
        const stored = await getStoredPlan(id, hash, 'estimated');
        if (stored) return reply.send({ plan: stored, source: 'cached', message: 'Plan evicted from cache — showing last saved version' });
        return reply.send({ plan: null, message: 'Plan not found — may have been evicted from cache' });
      }

      const planXml = planResult.recordset[0].query_plan;

      // Persist to PostgreSQL
      await savePlan(id, hash, 'estimated', planXml);

      return reply.send({ plan: planXml, source: 'live' });
    } catch (err) {
      closeSharedPool(conn.instance.id);
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: `Failed to retrieve plan: ${message}` });
    }
  });

  // GET /api/queries/:instanceId/:queryHash/actual-plan — actual plan (fetch + cache)
  app.get<{ Params: HashParam; Querystring: { force?: string } }>('/api/queries/:id/:hash/actual-plan', async (req, reply) => {
    const { id, hash } = req.params;
    const force = req.query.force === 'true';

    // Check stored actual plan first
    if (!force) {
      const stored = await getStoredPlan(id, hash, 'actual');
      if (stored) {
        return reply.send({ plan: stored, source: 'cached' });
      }
    }

    // Fetch from SQL Server
    const conn = await getSqlConnection(id);
    if (!conn) return reply.status(404).send({ error: 'Instance not found' });

    try {
      // dm_exec_query_statistics_xml takes session_id (not plan_handle)
      const result = await conn.sqlPool.request().query(`
        SELECT TOP 1
          CAST(qsx.query_plan AS NVARCHAR(MAX)) AS query_plan
        FROM sys.dm_exec_requests r
        CROSS APPLY sys.dm_exec_query_statistics_xml(r.session_id) qsx
        WHERE CONVERT(VARCHAR(100), r.query_hash, 1) = '${hash.replace(/'/g, "''")}'
          AND r.session_id <> @@SPID
      `);

      if (result.recordset.length === 0) {
        // No live actual plan — return stored if exists
        const stored = await getStoredPlan(id, hash, 'actual');
        if (stored) return reply.send({ plan: stored, source: 'cached', message: 'Query not currently executing — showing last captured actual plan' });
        return reply.send({ plan: null, message: 'Actual plan not available — query may not be currently executing, or lightweight profiling (TF 7412) is not enabled' });
      }

      const planXml = result.recordset[0].query_plan;

      // Persist to PostgreSQL
      await savePlan(id, hash, 'actual', planXml);

      return reply.send({ plan: planXml, source: 'live' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('query_statistics_xml') || message.includes('Invalid object')) {
        const stored = await getStoredPlan(id, hash, 'actual');
        if (stored) return reply.send({ plan: stored, source: 'cached', message: 'dm_exec_query_statistics_xml not available — showing last captured actual plan' });
        return reply.send({ plan: null, message: 'Actual plans not supported — requires SQL Server 2016 SP1+ with lightweight profiling (TF 7412)' });
      }
      closeSharedPool(conn.instance.id);
      return reply.status(500).send({ error: `Failed to retrieve actual plan: ${message}` });
    }
  });

  // GET /api/queries/:instanceId/:queryHash/waits — per-query wait stats from active sessions
  app.get<{ Params: HashParam }>('/api/queries/:id/:hash/waits', async (req, reply) => {
    const { id, hash } = req.params;

    const conn = await getSqlConnection(id);
    if (!conn) return reply.status(404).send({ error: 'Instance not found' });

    try {
      // Get wait stats for sessions currently running this query + recent session wait stats
      const result = await conn.sqlPool.request().query(`
        ;WITH query_sessions AS (
          SELECT DISTINCT r.session_id
          FROM sys.dm_exec_requests r
          CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) st
          WHERE CONVERT(VARCHAR(100), r.query_hash, 1) = '${hash.replace(/'/g, "''")}'
        )
        SELECT
          ws.wait_type,
          SUM(ws.wait_time_ms) AS wait_time_ms,
          SUM(ws.waiting_tasks_count) AS waiting_tasks_count,
          MAX(ws.max_wait_time_ms) AS max_wait_time_ms,
          MAX(s.login_name) AS login_name,
          MAX(s.program_name) AS program_name
        FROM sys.dm_exec_session_wait_stats ws
        INNER JOIN query_sessions qs ON qs.session_id = ws.session_id
        INNER JOIN sys.dm_exec_sessions s ON s.session_id = ws.session_id
        WHERE ws.wait_time_ms > 0
        GROUP BY ws.wait_type
        ORDER BY SUM(ws.wait_time_ms) DESC
      `);

      // Also get current wait info from dm_exec_requests for this query
      const currentResult = await conn.sqlPool.request().query(`
        SELECT
          r.wait_type,
          r.wait_time AS wait_time_ms,
          r.last_wait_type,
          s.login_name,
          s.program_name,
          r.granted_query_memory * 8 AS memory_grant_kb,
          mg.used_memory_kb,
          mg.requested_memory_kb
        FROM sys.dm_exec_requests r
        INNER JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
        LEFT JOIN sys.dm_exec_query_memory_grants mg ON mg.session_id = r.session_id
        CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) st
        WHERE CONVERT(VARCHAR(100), r.query_hash, 1) = '${hash.replace(/'/g, "''")}'
          AND s.is_user_process = 1
      `);

      return reply.send({
        session_waits: result.recordset,
        current_requests: currentResult.recordset,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // dm_exec_session_wait_stats requires SQL 2016+
      if (message.includes('session_wait_stats') || message.includes('Invalid object')) {
        return reply.send({ session_waits: [], current_requests: [], message: 'Per-session wait stats require SQL Server 2016+' });
      }
      closeSharedPool(conn.instance.id);
      return reply.status(500).send({ error: `Failed to retrieve query waits: ${message}` });
    }
  });
}
