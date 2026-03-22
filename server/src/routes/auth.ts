import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { hashPassword, verifyPassword, createTokenPair, verifyToken, type TokenPayload } from '../lib/auth.js';

interface LoginBody {
  username: string;
  password: string;
}

interface RefreshBody {
  refreshToken: string;
}

/**
 * Ensure a default admin user exists if ADMIN_USERNAME and ADMIN_PASSWORD are set.
 */
export async function ensureDefaultAdmin(pool: pg.Pool): Promise<void> {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;

  const existing = await pool.query('SELECT id FROM users LIMIT 1');
  if (existing.rows.length > 0) return;

  const passwordHash = await hashPassword(password);
  await pool.query(
    `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (username) DO NOTHING`,
    [username, passwordHash],
  );
}

export async function authRoutes(app: FastifyInstance, pool: pg.Pool, jwtSecret: string) {
  // POST /api/auth/login
  app.post<{ Body: LoginBody }>('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password required' });
    }

    const result = await pool.query(
      'SELECT id, username, password_hash, role FROM users WHERE username = $1',
      [username],
    );
    if (result.rows.length === 0) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const payload: TokenPayload = { userId: user.id, username: user.username, role: user.role };
    const tokens = createTokenPair(payload, jwtSecret);

    // Record last login time (best-effort, don't fail login if this fails)
    pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]).catch(() => {});

    return reply.send({
      ...tokens,
      user: { id: user.id, username: user.username, role: user.role },
    });
  });

  // POST /api/auth/refresh
  app.post<{ Body: RefreshBody }>('/api/auth/refresh', async (req, reply) => {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) {
      return reply.status(400).send({ error: 'Refresh token required' });
    }

    try {
      const payload = verifyToken(refreshToken, jwtSecret);

      // Verify user still exists
      const result = await pool.query(
        'SELECT id, username, role FROM users WHERE id = $1',
        [payload.userId],
      );
      if (result.rows.length === 0) {
        return reply.status(401).send({ error: 'User not found' });
      }

      const user = result.rows[0];
      const newPayload: TokenPayload = { userId: user.id, username: user.username, role: user.role };
      const tokens = createTokenPair(newPayload, jwtSecret);

      return reply.send(tokens);
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' });
    }
  });

  // GET /api/auth/me
  app.get('/api/auth/me', async (req, reply) => {
    // The auth middleware will have already verified the token and set req.user
    const user = (req as unknown as { user: TokenPayload }).user;
    if (!user) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }
    return reply.send({ id: user.userId, username: user.username, role: user.role });
  });
}
