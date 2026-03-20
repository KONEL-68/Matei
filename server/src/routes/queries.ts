import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import sql from 'mssql';
import type { AppConfig } from '../config.js';
import { buildConnectionConfig, type InstanceRecord } from '../lib/mssql.js';

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
    const interval = rangeToInterval(req.query.range);
    const orderBy = sortColumn(req.query.sort);
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 200);

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
         COUNT(*) AS sample_count
       FROM query_stats_raw
       WHERE instance_id = $1 AND collected_at > NOW() - $2::interval
       GROUP BY query_hash
       ORDER BY ${orderBy} DESC
       LIMIT $3`,
      [id, interval, limit],
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
      sample_count: Number(row.sample_count),
    }));

    return reply.send(rows);
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

  // GET /api/queries/:instanceId/:queryHash/plan — on-demand plan fetch
  app.get<{ Params: HashParam }>('/api/queries/:id/:hash/plan', async (req, reply) => {
    const { id, hash } = req.params;

    // Get the sql_handle from the most recent query_stats_raw entry
    // We need to connect to the SQL Server and call dm_exec_query_plan
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

    let sqlPool: sql.ConnectionPool | null = null;
    try {
      const connConfig = buildConnectionConfig(instance, config.encryptionKey);
      sqlPool = await new sql.ConnectionPool(connConfig).connect();

      const planResult = await sqlPool.request().query(`
        SELECT TOP 1
          qp.query_plan
        FROM sys.dm_exec_query_stats qs
        CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
        WHERE CONVERT(VARCHAR(100), qs.query_hash, 1) = '${hash.replace(/'/g, "''")}'
      `);

      if (planResult.recordset.length === 0) {
        return reply.send({ plan: null, message: 'Plan not found — may have been evicted from cache' });
      }

      return reply.send({ plan: planResult.recordset[0].query_plan });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: `Failed to retrieve plan: ${message}` });
    } finally {
      if (sqlPool) {
        try { await sqlPool.close(); } catch { /* ignore */ }
      }
    }
  });
}
