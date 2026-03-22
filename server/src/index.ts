import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './config.js';
import { getPool, checkConnection, closePool } from './db.js';
import { instanceRoutes } from './routes/instances.js';
import { metricRoutes } from './routes/metrics.js';
import { alertRoutes } from './routes/alerts.js';
import { authRoutes, ensureDefaultAdmin } from './routes/auth.js';
import { queryRoutes } from './routes/queries.js';
import { groupRoutes } from './routes/groups.js';
import { deadlockRoutes } from './routes/deadlocks.js';
import { settingsRoutes } from './routes/settings.js';
import { userRoutes } from './routes/users.js';
import { registerAuthHook } from './middleware/auth.js';
import { CollectorScheduler } from './collector/scheduler.js';
import { startPartitionManager } from './jobs/partition-manager.js';
import { startAggregator } from './jobs/aggregator.js';

const config = loadConfig();
const app = Fastify({ logger: true });

await app.register(cors);

const pool = getPool(config);

const jwtSecret = config.encryptionKey; // Reuse encryption key as JWT secret

// Auth middleware must be registered before routes
registerAuthHook(app, jwtSecret);

// Routes
await authRoutes(app, pool, jwtSecret);
await instanceRoutes(app, pool, config);
await metricRoutes(app, pool);
await alertRoutes(app, pool);
await queryRoutes(app, pool, config);
await groupRoutes(app, pool);
await deadlockRoutes(app, pool);
await settingsRoutes(app, pool);
await userRoutes(app, pool);

const scheduler = new CollectorScheduler(pool, config, app.log);

app.get('/health', async (_request, reply) => {
  try {
    await checkConnection(pool);
    return reply.send({ status: 'ok', database: 'connected' });
  } catch (err) {
    app.log.error(err, 'Health check failed');
    return reply.status(503).send({ status: 'error', database: 'disconnected' });
  }
});

app.get('/api/collector/status', async (_request, reply) => {
  return reply.send(scheduler.getStatus());
});

const shutdown = async () => {
  app.log.info('Shutting down...');
  await scheduler.stop();
  await app.close();
  await closePool();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port: config.apiPort, host: '0.0.0.0' });
  app.log.info(`Matei backend listening on port ${config.apiPort}`);

  // Create default admin user if configured
  try {
    await ensureDefaultAdmin(pool);
  } catch (err) {
    app.log.warn('Could not ensure default admin (users table may not exist yet, run migrations): ' + (err instanceof Error ? err.message : String(err)));
  }

  scheduler.start();
  const partitionTimer = startPartitionManager(pool, app.log);
  const aggregatorTimer = startAggregator(pool, app.log);
  app.log.info('Partition manager and aggregator started');

  // Cleanup timers on shutdown
  const originalShutdown = shutdown;
  const extendedShutdown = async () => {
    clearInterval(partitionTimer);
    clearInterval(aggregatorTimer);
    await originalShutdown();
  };
  process.removeListener('SIGINT', shutdown);
  process.removeListener('SIGTERM', shutdown);
  process.on('SIGINT', extendedShutdown);
  process.on('SIGTERM', extendedShutdown);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
