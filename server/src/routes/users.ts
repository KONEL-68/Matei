import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { hashPassword, verifyPassword, type TokenPayload } from '../lib/auth.js';

interface IdParam {
  id: string;
}

interface CreateUserBody {
  username: string;
  password: string;
}

interface ChangePasswordBody {
  current_password: string;
  new_password: string;
}

interface ResetPasswordBody {
  new_password: string;
}

function getUser(req: { user?: TokenPayload }): TokenPayload {
  return (req as unknown as { user: TokenPayload }).user;
}

export async function userRoutes(app: FastifyInstance, pool: pg.Pool) {
  // GET /api/users — list all users (admin only)
  app.get('/api/users', async (req, reply) => {
    const user = getUser(req);
    if (user.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const result = await pool.query(
      `SELECT id, username, role, created_at, last_login FROM users ORDER BY id`,
    );
    return reply.send(result.rows);
  });

  // POST /api/users — create user (admin only)
  app.post<{ Body: CreateUserBody }>('/api/users', async (req, reply) => {
    const user = getUser(req);
    if (user.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password required' });
    }
    if (password.length < 6) {
      return reply.status(400).send({ error: 'Password must be at least 6 characters' });
    }

    const passwordHash = await hashPassword(password);
    try {
      const result = await pool.query(
        `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')
         RETURNING id, username, role, created_at, last_login`,
        [username, passwordHash],
      );
      return reply.status(201).send(result.rows[0]);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        return reply.status(409).send({ error: 'Username already exists' });
      }
      throw err;
    }
  });

  // DELETE /api/users/:id — delete user (admin only, cannot delete self)
  app.delete<{ Params: IdParam }>('/api/users/:id', async (req, reply) => {
    const user = getUser(req);
    if (user.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const targetId = parseInt(req.params.id, 10);
    if (targetId === user.userId) {
      return reply.status(400).send({ error: 'Cannot delete your own account' });
    }

    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 RETURNING id`,
      [targetId],
    );
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return reply.send({ ok: true });
  });

  // POST /api/users/:id/reset-password — admin resets another user's password
  app.post<{ Params: IdParam; Body: ResetPasswordBody }>('/api/users/:id/reset-password', async (req, reply) => {
    const user = getUser(req);
    if (user.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const { new_password } = req.body ?? {};
    if (!new_password || new_password.length < 6) {
      return reply.status(400).send({ error: 'New password must be at least 6 characters' });
    }

    const targetId = parseInt(req.params.id, 10);
    const passwordHash = await hashPassword(new_password);
    const result = await pool.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id`,
      [passwordHash, targetId],
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return reply.send({ ok: true });
  });

  // POST /api/users/me/change-password — user changes own password
  app.post<{ Body: ChangePasswordBody }>('/api/users/me/change-password', async (req, reply) => {
    const user = getUser(req);
    const { current_password, new_password } = req.body ?? {};

    if (!current_password || !new_password) {
      return reply.status(400).send({ error: 'Current and new password required' });
    }
    if (new_password.length < 6) {
      return reply.status(400).send({ error: 'New password must be at least 6 characters' });
    }

    // Verify current password
    const userResult = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [user.userId],
    );
    if (userResult.rows.length === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const valid = await verifyPassword(current_password, userResult.rows[0].password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Current password is incorrect' });
    }

    const passwordHash = await hashPassword(new_password);
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, user.userId],
    );

    return reply.send({ ok: true });
  });
}
