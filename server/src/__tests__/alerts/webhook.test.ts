import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { AlertRule } from '../../alerts/engine.js';

// We need to re-import the webhook module for each test because it has
// module-level cache state (cachedConfig, cacheTime) that persists.
// Using vi.resetModules() + dynamic import ensures a fresh cache per test.

const mockGetWebhookConfig = vi.fn<() => Promise<{ url: string; enabled: boolean }>>();

vi.mock('../../routes/settings.js', () => ({
  getWebhookConfig: (...args: unknown[]) => mockGetWebhookConfig(...(args as [])),
}));

function makeAlerts(count = 1): AlertRule[] {
  return Array.from({ length: count }, (_, i) => ({
    alertType: `cpu_critical_${i}`,
    severity: 'critical' as const,
    message: `CPU critical on instance (alert ${i})`,
  }));
}

function makeMockPool(): { query: ReturnType<typeof vi.fn> } {
  return { query: vi.fn() };
}

// Helper to flush microtask queue so fire-and-forget promises resolve
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('webhook', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;
  let fireWebhook: typeof import('../../alerts/webhook.js').fireWebhook;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    mockGetWebhookConfig.mockReset();
    delete process.env.ALERT_WEBHOOK_URL;

    // Reset module registry to get fresh module-level cache
    vi.resetModules();
    const mod = await import('../../alerts/webhook.js');
    fireWebhook = mod.fireWebhook;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.ALERT_WEBHOOK_URL;
  });

  describe('payload formatting', () => {
    it('should POST JSON payload with correct structure', async () => {
      mockGetWebhookConfig.mockResolvedValue({ url: 'https://hooks.slack.com/test', enabled: true });
      const alerts = makeAlerts(1);
      const pool = makeMockPool();

      fireWebhook(42, alerts, 'PROD-SQL-01', pool as never);
      await flushPromises();

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://hooks.slack.com/test');
      expect(options).toMatchObject({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const body = JSON.parse(options!.body as string);
      expect(body.instanceId).toBe(42);
      expect(body.instanceName).toBe('PROD-SQL-01');
      expect(body.alerts).toHaveLength(1);
      expect(body.alerts[0].alertType).toBe('cpu_critical_0');
      expect(body.alerts[0].severity).toBe('critical');
      expect(body.timestamp).toBeDefined();
    });

    it('should include multiple alerts in single payload', async () => {
      mockGetWebhookConfig.mockResolvedValue({ url: 'https://hooks.slack.com/multi', enabled: true });
      const alerts = makeAlerts(3);

      fireWebhook(1, alerts, 'DEV-SQL', makeMockPool() as never);
      await flushPromises();

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.alerts).toHaveLength(3);
    });

    it('should handle missing instanceName (undefined)', async () => {
      mockGetWebhookConfig.mockResolvedValue({ url: 'https://hooks.slack.com/no-name', enabled: true });

      fireWebhook(5, makeAlerts(), undefined, makeMockPool() as never);
      await flushPromises();

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.instanceName).toBeUndefined();
      expect(body.instanceId).toBe(5);
    });

    it('should include ISO timestamp in payload', async () => {
      vi.setSystemTime(new Date('2026-06-15T12:30:00.000Z'));
      mockGetWebhookConfig.mockResolvedValue({ url: 'https://hooks.example.com/ts', enabled: true });

      fireWebhook(1, makeAlerts(), 'SQL1', makeMockPool() as never);
      await flushPromises();

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.timestamp).toBe('2026-06-15T12:30:00.000Z');
    });
  });

  describe('URL resolution and caching', () => {
    it('should use DB config when pool is provided', async () => {
      mockGetWebhookConfig.mockResolvedValue({ url: 'https://db-webhook.com/hook', enabled: true });

      fireWebhook(1, makeAlerts(), 'SQL1', makeMockPool() as never);
      await flushPromises();

      expect(mockGetWebhookConfig).toHaveBeenCalledOnce();
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy.mock.calls[0][0]).toBe('https://db-webhook.com/hook');
    });

    it('should fall back to ALERT_WEBHOOK_URL env var when no pool', async () => {
      process.env.ALERT_WEBHOOK_URL = 'https://env-webhook.com/fallback';

      fireWebhook(1, makeAlerts(), 'SQL1');
      await flushPromises();

      expect(mockGetWebhookConfig).not.toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy.mock.calls[0][0]).toBe('https://env-webhook.com/fallback');
    });

    it('should fall back to env var when getWebhookConfig throws', async () => {
      process.env.ALERT_WEBHOOK_URL = 'https://env-fallback.com/hook';
      mockGetWebhookConfig.mockRejectedValue(new Error('DB connection failed'));

      fireWebhook(1, makeAlerts(), 'SQL1', makeMockPool() as never);
      await flushPromises();

      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy.mock.calls[0][0]).toBe('https://env-fallback.com/hook');
    });

    it('should cache DB config and reuse within 60s TTL', async () => {
      mockGetWebhookConfig.mockResolvedValue({ url: 'https://cached.com/hook', enabled: true });
      const pool = makeMockPool();

      // First call populates cache
      fireWebhook(1, makeAlerts(), 'SQL1', pool as never);
      await flushPromises();

      // Second call 30s later -- should use cache, not call getWebhookConfig again
      vi.advanceTimersByTime(30_000);
      fireWebhook(2, makeAlerts(), 'SQL2', pool as never);
      await flushPromises();

      // getWebhookConfig called only once (cached on second call)
      expect(mockGetWebhookConfig).toHaveBeenCalledOnce();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should refresh cache after 60s TTL expires', async () => {
      mockGetWebhookConfig.mockResolvedValue({ url: 'https://cached.com/hook', enabled: true });
      const pool = makeMockPool();

      // First call
      fireWebhook(1, makeAlerts(), 'SQL1', pool as never);
      await flushPromises();

      // 61s later -- past TTL
      vi.advanceTimersByTime(61_000);
      fireWebhook(2, makeAlerts(), 'SQL2', pool as never);
      await flushPromises();

      expect(mockGetWebhookConfig).toHaveBeenCalledTimes(2);
    });

    it('should not POST when webhook is disabled in config', async () => {
      mockGetWebhookConfig.mockResolvedValue({ url: 'https://disabled.com/hook', enabled: false });

      fireWebhook(1, makeAlerts(), 'SQL1', makeMockPool() as never);
      await flushPromises();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should not POST when URL is empty string', async () => {
      mockGetWebhookConfig.mockResolvedValue({ url: '', enabled: true });

      fireWebhook(1, makeAlerts(), 'SQL1', makeMockPool() as never);
      await flushPromises();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should not POST when no URL configured and no env var', async () => {
      delete process.env.ALERT_WEBHOOK_URL;

      fireWebhook(1, makeAlerts(), 'SQL1');
      await flushPromises();

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('early exit', () => {
    it('should not resolve URL or POST when alerts array is empty', async () => {
      mockGetWebhookConfig.mockResolvedValue({ url: 'https://hooks.example.com/test', enabled: true });

      fireWebhook(1, [], 'SQL1', makeMockPool() as never);
      await flushPromises();

      expect(mockGetWebhookConfig).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should log error and not throw when fetch fails', async () => {
      mockGetWebhookConfig.mockResolvedValue({ url: 'https://bad-hook.com/fail', enabled: true });
      fetchSpy.mockRejectedValue(new Error('Network timeout'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
      fireWebhook(1, makeAlerts(), 'SQL1', makeMockPool() as never);
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalledOnce();
      expect(consoleSpy.mock.calls[0][0]).toContain('[webhook] Failed to POST');
      expect(consoleSpy.mock.calls[0][0]).toContain('Network timeout');
      consoleSpy.mockRestore();
    });

    it('should log non-Error rejection values', async () => {
      mockGetWebhookConfig.mockResolvedValue({ url: 'https://bad-hook.com/fail2', enabled: true });
      fetchSpy.mockRejectedValue('string error');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      fireWebhook(1, makeAlerts(), 'SQL1', makeMockPool() as never);
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalledOnce();
      expect(consoleSpy.mock.calls[0][0]).toContain('string error');
      consoleSpy.mockRestore();
    });

    it('should use 5-second timeout signal on fetch', async () => {
      mockGetWebhookConfig.mockResolvedValue({ url: 'https://slow-hook.com/timeout', enabled: true });

      fireWebhook(1, makeAlerts(), 'SQL1', makeMockPool() as never);
      await flushPromises();

      const options = fetchSpy.mock.calls[0][1]!;
      expect(options.signal).toBeDefined();
    });
  });
});
