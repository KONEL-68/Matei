import type pg from 'pg';
import type { AlertRule } from './engine.js';
import { getWebhookConfig } from '../routes/settings.js';

export interface WebhookPayload {
  instanceId: number;
  instanceName?: string;
  alerts: AlertRule[];
  timestamp: string;
}

// Cache webhook config to avoid DB query on every alert (refresh every 60s)
let cachedConfig: { url: string; enabled: boolean } | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60_000;

async function resolveWebhookUrl(pool?: pg.Pool): Promise<string | null> {
  const now = Date.now();

  if (cachedConfig && now - cacheTime < CACHE_TTL_MS) {
    return cachedConfig.enabled ? cachedConfig.url || null : null;
  }

  if (pool) {
    try {
      cachedConfig = await getWebhookConfig(pool);
      cacheTime = now;
      return cachedConfig.enabled ? cachedConfig.url || null : null;
    } catch {
      // Fall through to env
    }
  }

  // Fallback to env var
  return process.env.ALERT_WEBHOOK_URL || null;
}

/**
 * Fire-and-forget webhook POST. Logs errors but never throws.
 */
export function fireWebhook(
  instanceId: number,
  alerts: AlertRule[],
  instanceName?: string,
  pool?: pg.Pool,
): void {
  if (alerts.length === 0) return;

  resolveWebhookUrl(pool).then((webhookUrl) => {
    if (!webhookUrl) return;

    const payload: WebhookPayload = {
      instanceId,
      instanceName,
      alerts,
      timestamp: new Date().toISOString(),
    };

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    }).catch((err) => {
      console.error(`[webhook] Failed to POST to ${webhookUrl}: ${err instanceof Error ? err.message : String(err)}`);
    });
  }).catch(() => {
    // resolveWebhookUrl should never throw, but just in case
  });
}
