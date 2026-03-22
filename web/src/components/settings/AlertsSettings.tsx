import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';

interface SettingsData {
  alertThresholds: Record<string, Record<string, number>>;
}

interface WebhookConfig {
  url: string;
  enabled: boolean;
}

export function AlertsSettings() {
  const { data, isLoading } = useQuery<SettingsData>({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await authFetch('/api/settings');
      if (!res.ok) throw new Error('Failed to load settings');
      return res.json();
    },
  });

  const { data: webhookData } = useQuery<WebhookConfig>({
    queryKey: ['webhook-config'],
    queryFn: async () => {
      const res = await authFetch('/api/settings/webhook');
      if (!res.ok) throw new Error('Failed to load webhook config');
      return res.json();
    },
  });

  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookInited, setWebhookInited] = useState(false);
  const [webhookMsg, setWebhookMsg] = useState('');

  // Initialize form from fetched data
  if (webhookData && !webhookInited) {
    setWebhookUrl(webhookData.url);
    setWebhookEnabled(webhookData.enabled);
    setWebhookInited(true);
  }

  const saveWebhook = useMutation({
    mutationFn: async () => {
      const res = await authFetch('/api/settings/webhook', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl, enabled: webhookEnabled }),
      });
      if (!res.ok) throw new Error('Failed to save');
    },
    onSuccess: () => setWebhookMsg('Saved'),
    onError: () => setWebhookMsg('Failed to save'),
  });

  const testWebhook = useMutation({
    mutationFn: async () => {
      const res = await authFetch('/api/settings/webhook/test', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Test failed');
      return data;
    },
    onSuccess: (data) => setWebhookMsg(`Test sent (HTTP ${data.status})`),
    onError: (err: Error) => setWebhookMsg(err.message),
  });

  if (isLoading) return <div className="text-sm text-gray-500 dark:text-gray-400">Loading...</div>;

  const thresholds = data?.alertThresholds;
  if (!thresholds) return <div className="text-sm text-gray-500 dark:text-gray-400">No data available.</div>;

  const rows: Array<{ metric: string; warning: string; critical: string }> = [
    {
      metric: 'CPU',
      warning: `>= ${thresholds.cpu_warning.threshold}% (${thresholds.cpu_warning.cycles} cycles)`,
      critical: `>= ${thresholds.cpu_critical.threshold}% (${thresholds.cpu_critical.cycles} cycles)`,
    },
    {
      metric: 'Memory',
      warning: '-',
      critical: `< ${thresholds.memory_critical.available_mb} MB available`,
    },
    {
      metric: 'Disk',
      warning: `> ${thresholds.disk_warning.used_pct}% used`,
      critical: `> ${thresholds.disk_critical.used_pct}% used`,
    },
    {
      metric: 'File I/O Latency',
      warning: `> ${thresholds.io_warning.latency_ms} ms`,
      critical: `> ${thresholds.io_critical.latency_ms} ms`,
    },
    {
      metric: 'Blocking',
      warning: `> ${thresholds.blocking_warning.seconds}s`,
      critical: `> ${thresholds.blocking_critical.seconds}s`,
    },
    {
      metric: 'Unreachable',
      warning: '-',
      critical: `${thresholds.unreachable.cycles} consecutive cycles`,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Current alert thresholds (read-only). Customization coming in a future release.
        </p>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            <tr>
              <th className="px-4 py-2">Metric</th>
              <th className="px-4 py-2">Warning</th>
              <th className="px-4 py-2">Critical</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((r) => (
              <tr key={r.metric}>
                <td className="px-4 py-2 font-medium text-gray-900 dark:text-gray-100">{r.metric}</td>
                <td className="px-4 py-2 text-yellow-600 dark:text-yellow-400">{r.warning}</td>
                <td className="px-4 py-2 text-red-600 dark:text-red-400">{r.critical}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Webhook configuration */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Webhook Notifications</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={webhookEnabled}
                onChange={(e) => { setWebhookEnabled(e.target.checked); setWebhookMsg(''); }}
                className="rounded border-gray-300"
              />
              Enabled
            </label>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Webhook URL</label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => { setWebhookUrl(e.target.value); setWebhookMsg(''); }}
              placeholder="https://hooks.slack.com/services/..."
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => saveWebhook.mutate()}
              disabled={saveWebhook.isPending}
              className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => testWebhook.mutate()}
              disabled={testWebhook.isPending || !webhookUrl}
              className="rounded bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Test
            </button>
            {webhookMsg && <span className="text-sm text-gray-600 dark:text-gray-400">{webhookMsg}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
