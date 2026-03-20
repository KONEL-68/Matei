import type { AlertRule } from './engine.js';

const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL;

export interface WebhookPayload {
  instanceId: number;
  instanceName?: string;
  alerts: AlertRule[];
  timestamp: string;
}

/**
 * Fire-and-forget webhook POST. Logs errors but never throws.
 */
export function fireWebhook(
  instanceId: number,
  alerts: AlertRule[],
  instanceName?: string,
): void {
  if (!WEBHOOK_URL || alerts.length === 0) return;

  const payload: WebhookPayload = {
    instanceId,
    instanceName,
    alerts,
    timestamp: new Date().toISOString(),
  };

  fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  }).catch((err) => {
    console.error(`[webhook] Failed to POST to ${WEBHOOK_URL}: ${err instanceof Error ? err.message : String(err)}`);
  });
}
