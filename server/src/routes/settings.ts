import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

interface WebhookBody {
  url: string;
  enabled: boolean;
}

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

  // GET /api/settings/webhook — current webhook config
  app.get('/api/settings/webhook', async (_req, reply) => {
    try {
      const result = await pool.query(
        `SELECT value FROM settings WHERE key = 'webhook_config'`,
      );
      if (result.rows.length > 0) {
        return reply.send(JSON.parse(result.rows[0].value));
      }
    } catch {
      // settings table may not exist yet
    }

    // Fallback to env var
    const envUrl = process.env.ALERT_WEBHOOK_URL;
    return reply.send({
      url: envUrl || '',
      enabled: !!envUrl,
    });
  });

  // PUT /api/settings/webhook — save webhook config
  app.put<{ Body: WebhookBody }>('/api/settings/webhook', async (req, reply) => {
    const { url, enabled } = req.body ?? {};
    const config = JSON.stringify({ url: url || '', enabled: !!enabled });

    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('webhook_config', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [config],
    );

    return reply.send({ ok: true });
  });

  // POST /api/settings/webhook/test — send a test webhook payload
  app.post('/api/settings/webhook/test', async (_req, reply) => {
    const webhookConfig = await getWebhookConfig(pool);
    if (!webhookConfig.url) {
      return reply.status(400).send({ error: 'No webhook URL configured' });
    }

    const testPayload = {
      instanceId: 0,
      instanceName: 'Test Instance',
      alerts: [{ metric: 'test', severity: 'info', message: 'This is a test webhook from Matei' }],
      timestamp: new Date().toISOString(),
    };

    try {
      const res = await fetch(webhookConfig.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(5000),
      });
      return reply.send({ ok: true, status: res.status });
    } catch (err) {
      return reply.status(502).send({
        error: `Webhook request failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
}

/** Read webhook config from DB, falling back to env var. Exported for webhook.ts. */
export async function getWebhookConfig(pool: pg.Pool): Promise<{ url: string; enabled: boolean }> {
  try {
    const result = await pool.query(
      `SELECT value FROM settings WHERE key = 'webhook_config'`,
    );
    if (result.rows.length > 0) {
      return JSON.parse(result.rows[0].value);
    }
  } catch {
    // settings table may not exist yet
  }

  const envUrl = process.env.ALERT_WEBHOOK_URL;
  return { url: envUrl || '', enabled: !!envUrl };
}
