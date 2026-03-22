import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

export async function settingsRoutes(app: FastifyInstance, pool: pg.Pool) {
  // GET /api/settings — current configuration (read-only)
  app.get('/api/settings', async (_req, reply) => {
    return reply.send({
      retention: {
        raw_days: 7,
        aggregate_5min_days: 30,
        aggregate_hourly_days: 365,
      },
      alertThresholds: {
        cpu_warning: { threshold: 75, cycles: 3 },
        cpu_critical: { threshold: 90, cycles: 3 },
        memory_critical: { available_mb: 512 },
        disk_warning: { used_pct: 90 },
        disk_critical: { used_pct: 95 },
        io_warning: { latency_ms: 20 },
        io_critical: { latency_ms: 50 },
        blocking_warning: { seconds: 60 },
        blocking_critical: { seconds: 300 },
        unreachable: { cycles: 3 },
      },
      collector: {
        workers: 40,
        interval_ms: 15000,
      },
    });
  });
}
