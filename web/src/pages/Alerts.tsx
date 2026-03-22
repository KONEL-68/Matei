import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';

interface Alert {
  id: number;
  instance_id: number;
  instance_name: string;
  alert_type: string;
  severity: 'warning' | 'critical';
  message: string;
  acknowledged: boolean;
  created_at: string;
}

const severityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300',
};

export function Alerts() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [ackFilter, setAckFilter] = useState<string>('false');

  const params = new URLSearchParams();
  if (severityFilter) params.set('severity', severityFilter);
  if (ackFilter) params.set('acknowledged', ackFilter);

  const { data: alerts = [], isLoading } = useQuery<Alert[]>({
    queryKey: ['alerts', severityFilter, ackFilter],
    queryFn: () => authFetch(`/api/alerts?${params}`).then((r) => r.json()),
    refetchInterval: 15_000,
  });

  const ackMutation = useMutation({
    mutationFn: (id: number) =>
      authFetch(`/api/alerts/${id}/acknowledge`, { method: 'POST' }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['alertCount'] });
    },
  });

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Alerts</h2>

      <div className="mt-4 flex gap-4">
        <select
          className="rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
        >
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
        </select>

        <select
          className="rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          value={ackFilter}
          onChange={(e) => setAckFilter(e.target.value)}
        >
          <option value="">All</option>
          <option value="false">Unacknowledged</option>
          <option value="true">Acknowledged</option>
        </select>
      </div>

      {isLoading ? (
        <div className="mt-6 text-center text-gray-500 dark:text-gray-400">Loading...</div>
      ) : alerts.length === 0 ? (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
          <p className="text-gray-500 dark:text-gray-400">No alerts.</p>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Instance</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Message</th>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {alerts.map((alert) => (
                <tr key={alert.id} className={`${alert.acknowledged ? 'opacity-60' : ''} dark:text-gray-300`}>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${severityColors[alert.severity] ?? 'bg-gray-100 text-gray-800'}`}
                    >
                      {alert.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{alert.instance_name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{alert.alert_type}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{alert.message}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {new Date(alert.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        className="rounded bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300 dark:hover:bg-blue-800"
                        onClick={() => navigate(`/instances/${alert.instance_id}?at=${encodeURIComponent(alert.created_at)}&range=1h`)}
                      >
                        Investigate
                      </button>
                      {!alert.acknowledged && (
                        <button
                          className="rounded bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                          onClick={() => ackMutation.mutate(alert.id)}
                          disabled={ackMutation.isPending}
                        >
                          Acknowledge
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
