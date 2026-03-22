import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { AppConfig } from '../config.js';
import { encrypt } from '../lib/crypto.js';
import { buildConnectionConfig, testConnection } from '../lib/mssql.js';
import type { InstanceRecord } from '../lib/mssql.js';

interface InstanceBody {
  name: string;
  host: string;
  port?: number;
  auth_type?: 'sql' | 'windows';
  username?: string;
  password?: string;
  group_id?: number | null;
}

interface IdParam {
  id: string;
}

export async function instanceRoutes(app: FastifyInstance, pool: pg.Pool, config: AppConfig) {
  // GET /api/instances — list all
  app.get('/api/instances', async (_req, reply) => {
    const result = await pool.query(
      `SELECT i.id, i.name, i.host, i.port, i.auth_type, i.status, i.last_seen,
              i.is_enabled, i.created_at, i.updated_at, i.group_id, g.name AS group_name
       FROM instances i
       LEFT JOIN instance_groups g ON g.id = i.group_id
       ORDER BY i.name`,
    );
    return reply.send(result.rows);
  });

  // GET /api/instances/:id — single instance
  app.get<{ Params: IdParam }>('/api/instances/:id', async (req, reply) => {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT i.id, i.name, i.host, i.port, i.auth_type, i.status, i.last_seen,
              i.is_enabled, i.created_at, i.updated_at, i.group_id, g.name AS group_name
       FROM instances i
       LEFT JOIN instance_groups g ON g.id = i.group_id
       WHERE i.id = $1`,
      [id],
    );
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Instance not found' });
    }
    return reply.send(result.rows[0]);
  });

  // POST /api/instances — create
  app.post<{ Body: InstanceBody }>('/api/instances', async (req, reply) => {
    const { name, host, port = 1433, auth_type = 'sql', username, password, group_id } = req.body;

    if (!host || !host.trim()) {
      return reply.status(400).send({ error: 'host is required' });
    }
    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'name is required' });
    }

    // Encrypt credentials
    let encryptedCreds: string | null = null;
    if (username || password) {
      const creds = JSON.stringify({ username: username ?? '', password: password ?? '' });
      encryptedCreds = encrypt(creds, config.encryptionKey);
    }

    try {
      const result = await pool.query(
        `INSERT INTO instances (name, host, port, auth_type, encrypted_credentials, group_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, host, port, auth_type, status, last_seen, is_enabled, created_at, updated_at, group_id`,
        [name.trim(), host.trim(), port, auth_type, encryptedCreds ? Buffer.from(encryptedCreds, 'utf8') : null, group_id ?? null],
      );
      return reply.status(201).send(result.rows[0]);
    } catch (err: unknown) {
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === '23505') {
        const msg = pgErr.constraint?.includes('name')
          ? 'An instance with this name already exists'
          : 'An instance with this host:port already exists';
        return reply.status(409).send({ error: msg });
      }
      throw err;
    }
  });

  // PUT /api/instances/:id — update
  app.put<{ Params: IdParam; Body: InstanceBody }>('/api/instances/:id', async (req, reply) => {
    const { id } = req.params;
    const { name, host, port = 1433, auth_type = 'sql', username, password, group_id } = req.body;

    if (!host || !host.trim()) {
      return reply.status(400).send({ error: 'host is required' });
    }
    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'name is required' });
    }

    let encryptedCreds: string | null = null;
    if (username || password) {
      const creds = JSON.stringify({ username: username ?? '', password: password ?? '' });
      encryptedCreds = encrypt(creds, config.encryptionKey);
    }

    try {
      const result = await pool.query(
        `UPDATE instances
         SET name = $1, host = $2, port = $3, auth_type = $4,
             encrypted_credentials = $5, group_id = $6, updated_at = NOW()
         WHERE id = $7
         RETURNING id, name, host, port, auth_type, status, last_seen, is_enabled, created_at, updated_at, group_id`,
        [name.trim(), host.trim(), port, auth_type, encryptedCreds ? Buffer.from(encryptedCreds, 'utf8') : null, group_id ?? null, id],
      );
      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Instance not found' });
      }
      return reply.send(result.rows[0]);
    } catch (err: unknown) {
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === '23505') {
        const msg = pgErr.constraint?.includes('name')
          ? 'An instance with this name already exists'
          : 'An instance with this host:port already exists';
        return reply.status(409).send({ error: msg });
      }
      throw err;
    }
  });

  // DELETE /api/instances/:id — hard delete
  app.delete<{ Params: IdParam }>('/api/instances/:id', async (req, reply) => {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM instances WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Instance not found' });
    }
    return reply.send({ ok: true });
  });

  // POST /api/instances/:id/test — test saved instance connection
  app.post<{ Params: IdParam }>('/api/instances/:id/test', async (req, reply) => {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id, host, port, auth_type, encrypted_credentials FROM instances WHERE id = $1',
      [id],
    );
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Instance not found' });
    }

    const row = result.rows[0];
    const instance: InstanceRecord = {
      id: row.id,
      host: row.host,
      port: row.port,
      auth_type: row.auth_type,
      encrypted_credentials: row.encrypted_credentials ? row.encrypted_credentials.toString('utf8') : null,
    };

    const connConfig = buildConnectionConfig(instance, config.encryptionKey);
    const testResult = await testConnection(connConfig);

    if (testResult.ok) {
      await pool.query(
        "UPDATE instances SET status = 'online', last_seen = NOW() WHERE id = $1",
        [id],
      );
      return reply.send({ ok: true, health: testResult.result[0] ?? null });
    }

    await pool.query(
      "UPDATE instances SET status = 'unreachable' WHERE id = $1",
      [id],
    );
    return reply.send({ ok: false, error: testResult.error });
  });

  // POST /api/instances/test — test connection without saving
  app.post<{ Body: InstanceBody }>('/api/instances/test', async (req, reply) => {
    const { host, port = 1433, auth_type = 'sql', username, password } = req.body;

    if (!host || !host.trim()) {
      return reply.status(400).send({ error: 'host is required' });
    }

    let encryptedCreds: string | null = null;
    if (username || password) {
      const creds = JSON.stringify({ username: username ?? '', password: password ?? '' });
      encryptedCreds = encrypt(creds, config.encryptionKey);
    }

    const instance: InstanceRecord = {
      id: 0,
      host: host.trim(),
      port,
      auth_type,
      encrypted_credentials: encryptedCreds,
    };

    const connConfig = buildConnectionConfig(instance, config.encryptionKey);
    const testResult = await testConnection(connConfig);

    if (testResult.ok) {
      return reply.send({ ok: true, health: testResult.result[0] ?? null });
    }
    return reply.send({ ok: false, error: testResult.error });
  });
}
