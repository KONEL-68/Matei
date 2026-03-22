import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

interface IdParam {
  id: string;
}

interface GroupBody {
  name: string;
  description?: string;
  position?: number;
}

interface AssignBody {
  instanceIds: number[];
}

export async function groupRoutes(app: FastifyInstance, pool: pg.Pool) {
  // GET /api/groups — list all groups with instance count
  app.get('/api/groups', async (_req, reply) => {
    const result = await pool.query(
      `SELECT g.id, g.name, g.description, g.position, g.created_at,
              COUNT(i.id)::int AS instance_count
       FROM instance_groups g
       LEFT JOIN instances i ON i.group_id = g.id
       GROUP BY g.id
       ORDER BY g.position, g.name`,
    );
    return reply.send(result.rows);
  });

  // GET /api/groups/:id — single group with its instances
  app.get<{ Params: IdParam }>('/api/groups/:id', async (req, reply) => {
    const { id } = req.params;
    const groupResult = await pool.query(
      'SELECT id, name, description, position, created_at FROM instance_groups WHERE id = $1',
      [id],
    );
    if (groupResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Group not found' });
    }

    const instancesResult = await pool.query(
      `SELECT id, name, host, port, status, last_seen, is_enabled
       FROM instances WHERE group_id = $1 ORDER BY name`,
      [id],
    );

    return reply.send({
      ...groupResult.rows[0],
      instances: instancesResult.rows,
    });
  });

  // POST /api/groups — create group
  app.post<{ Body: GroupBody }>('/api/groups', async (req, reply) => {
    const { name, description, position } = req.body;

    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'name is required' });
    }

    try {
      const result = await pool.query(
        `INSERT INTO instance_groups (name, description, position)
         VALUES ($1, $2, $3)
         RETURNING id, name, description, position, created_at`,
        [name.trim(), description ?? null, position ?? 0],
      );
      return reply.status(201).send(result.rows[0]);
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        return reply.status(409).send({ error: 'A group with this name already exists' });
      }
      throw err;
    }
  });

  // PUT /api/groups/:id — update group
  app.put<{ Params: IdParam; Body: GroupBody }>('/api/groups/:id', async (req, reply) => {
    const { id } = req.params;
    const { name, description, position } = req.body;

    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'name is required' });
    }

    try {
      const result = await pool.query(
        `UPDATE instance_groups
         SET name = $1, description = $2, position = $3
         WHERE id = $4
         RETURNING id, name, description, position, created_at`,
        [name.trim(), description ?? null, position ?? 0, id],
      );
      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Group not found' });
      }
      return reply.send(result.rows[0]);
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        return reply.status(409).send({ error: 'A group with this name already exists' });
      }
      throw err;
    }
  });

  // DELETE /api/groups/:id — delete group (instances become ungrouped)
  app.delete<{ Params: IdParam }>('/api/groups/:id', async (req, reply) => {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM instance_groups WHERE id = $1 RETURNING id',
      [id],
    );
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Group not found' });
    }
    return reply.send({ ok: true });
  });

  // PUT /api/groups/:id/instances — assign instances to group
  app.put<{ Params: IdParam; Body: AssignBody }>('/api/groups/:id/instances', async (req, reply) => {
    const { id } = req.params;
    const { instanceIds } = req.body;

    if (!Array.isArray(instanceIds)) {
      return reply.status(400).send({ error: 'instanceIds must be an array' });
    }

    // Verify group exists
    const groupCheck = await pool.query('SELECT id FROM instance_groups WHERE id = $1', [id]);
    if (groupCheck.rows.length === 0) {
      return reply.status(404).send({ error: 'Group not found' });
    }

    await pool.query(
      'UPDATE instances SET group_id = $1 WHERE id = ANY($2)',
      [id, instanceIds],
    );

    return reply.send({ ok: true });
  });
}
