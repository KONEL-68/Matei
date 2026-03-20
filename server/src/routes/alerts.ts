import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

interface AlertQuerystring {
  severity?: 'warning' | 'critical';
  acknowledged?: 'true' | 'false';
}

interface IdParam {
  id: string;
}

export async function alertRoutes(app: FastifyInstance, pool: pg.Pool) {
  // GET /api/alerts — list alerts with optional filters
  app.get<{ Querystring: AlertQuerystring }>('/api/alerts', async (req, reply) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (req.query.severity) {
      conditions.push(`a.severity = $${idx++}`);
      params.push(req.query.severity);
    }

    if (req.query.acknowledged !== undefined) {
      conditions.push(`a.acknowledged = $${idx++}`);
      params.push(req.query.acknowledged === 'true');
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT a.id, a.instance_id, i.name AS instance_name, a.alert_type, a.severity,
              a.message, a.acknowledged, a.created_at
       FROM alerts a
       JOIN instances i ON i.id = a.instance_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT 200`,
      params,
    );

    return reply.send(result.rows);
  });

  // GET /api/alerts/count — unacknowledged count for badge
  app.get('/api/alerts/count', async (_req, reply) => {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM alerts WHERE acknowledged = false`,
    );
    return reply.send({ count: result.rows[0].count });
  });

  // POST /api/alerts/:id/acknowledge
  app.post<{ Params: IdParam }>('/api/alerts/:id/acknowledge', async (req, reply) => {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE alerts SET acknowledged = true WHERE id = $1 RETURNING id`,
      [id],
    );

    if (result.rowCount === 0) {
      return reply.status(404).send({ error: 'Alert not found' });
    }

    return reply.send({ id: Number(id), acknowledged: true });
  });
}
