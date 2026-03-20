import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, type TokenPayload } from '../lib/auth.js';

/** Routes that do NOT require authentication. */
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/refresh',
  '/health',
];

function isPublicPath(url: string): boolean {
  // Strip query string
  const path = url.split('?')[0];
  return PUBLIC_PATHS.some((p) => path === p);
}

/**
 * Register a Fastify preHandler hook that verifies JWT on all /api/* routes
 * except the public paths listed above.
 */
export function registerAuthHook(app: FastifyInstance, jwtSecret: string): void {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (isPublicPath(req.url)) return;
    // Only protect /api/* routes
    if (!req.url.startsWith('/api/')) return;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);
    try {
      const payload: TokenPayload = verifyToken(token, jwtSecret);
      // Attach user to request for downstream handlers
      (req as unknown as { user: TokenPayload }).user = payload;
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }
  });
}
