import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

interface IdParam {
  id: string;
}

interface RangeQuery {
  range?: '1h' | '6h' | '24h' | '7d';
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

export async function deadlockRoutes(app: FastifyInstance, pool: pg.Pool) {
  // GET /api/metrics/:id/deadlocks?range=1h|6h|24h|7d — deadlocks for an instance
  app.get<{ Params: IdParam; Querystring: RangeQuery }>('/api/metrics/:id/deadlocks', async (req, reply) => {
    const { id } = req.params;
    const interval = rangeToInterval(req.query.range);

    const result = await pool.query(
      `SELECT id, deadlock_time, victim_spid, victim_query, collected_at
       FROM deadlocks
       WHERE instance_id = $1 AND deadlock_time > NOW() - $2::interval
       ORDER BY deadlock_time DESC
       LIMIT 100`,
      [id, interval],
    );

    return reply.send(result.rows);
  });

  // GET /api/deadlocks/:deadlockId — single deadlock with full XML
  app.get<{ Params: { deadlockId: string } }>('/api/deadlocks/:deadlockId', async (req, reply) => {
    const { deadlockId } = req.params;

    const result = await pool.query(
      `SELECT id, instance_id, deadlock_time, victim_spid, victim_query, deadlock_xml, collected_at
       FROM deadlocks WHERE id = $1`,
      [deadlockId],
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Deadlock not found' });
    }

    return reply.send(result.rows[0]);
  });

  // GET /api/deadlocks/recent — fleet-wide recent deadlocks (last hour)
  app.get('/api/deadlocks/recent', async (_req, reply) => {
    const result = await pool.query(
      `SELECT d.id, d.instance_id, i.name AS instance_name,
              d.deadlock_time, d.victim_spid, d.victim_query, d.collected_at
       FROM deadlocks d
       JOIN instances i ON i.id = d.instance_id
       WHERE d.deadlock_time > NOW() - INTERVAL '1 hour'
       ORDER BY d.deadlock_time DESC
       LIMIT 50`,
    );

    return reply.send(result.rows);
  });

  // GET /api/deadlocks/counts — deadlock count per instance in last hour (for dashboard badges)
  app.get('/api/deadlocks/counts', async (_req, reply) => {
    const result = await pool.query(
      `SELECT instance_id, COUNT(*)::int AS count
       FROM deadlocks
       WHERE deadlock_time > NOW() - INTERVAL '1 hour'
       GROUP BY instance_id`,
    );

    const counts: Record<number, number> = {};
    for (const row of result.rows) {
      counts[row.instance_id] = row.count;
    }
    return reply.send(counts);
  });
}
