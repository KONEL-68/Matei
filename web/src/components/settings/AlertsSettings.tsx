import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';

interface SettingsData {
  alertThresholds: Record<string, Record<string, number>>;
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
  );
}
