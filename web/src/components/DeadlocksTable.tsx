import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';

interface DeadlockSummary {
  id: number;
  deadlock_time: string;
  victim_spid: number | null;
  victim_query: string | null;
  collected_at: string;
}

interface DeadlockDetail {
  id: number;
  instance_id: number;
  deadlock_time: string;
  victim_spid: number | null;
  victim_query: string | null;
  deadlock_xml: string;
  collected_at: string;
}

interface Props {
  instanceId: string;
  range: string;
}

export function DeadlocksTable({ instanceId, range }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: deadlocks = [] } = useQuery<DeadlockSummary[]>({
    queryKey: ['deadlocks', instanceId, range],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/deadlocks?range=${range}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: detail } = useQuery<DeadlockDetail>({
    queryKey: ['deadlock-detail', expandedId],
    queryFn: async () => {
      const res = await authFetch(`/api/deadlocks/${expandedId}`);
      if (!res.ok) throw new Error('Failed to load');
      return res.json();
    },
    enabled: expandedId !== null,
  });

  if (deadlocks.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Deadlocks</h3>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No deadlocks detected in this time range.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Deadlocks
          <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-100 px-1.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
            {deadlocks.length}
          </span>
        </h3>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          <tr>
            <th className="px-4 py-2">Time</th>
            <th className="px-4 py-2">Victim SPID</th>
            <th className="px-4 py-2">Victim Query</th>
            <th className="px-4 py-2 text-right">Detail</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {deadlocks.map((d) => (
            <tr key={d.id}>
              <td className="px-4 py-2 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                {new Date(d.deadlock_time).toLocaleString()}
              </td>
              <td className="px-4 py-2 text-gray-600 dark:text-gray-400">
                {d.victim_spid ?? '-'}
              </td>
              <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-400 max-w-xs truncate">
                {d.victim_query ?? '-'}
              </td>
              <td className="px-4 py-2 text-right">
                <button
                  onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
                  className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
                >
                  {expandedId === d.id ? 'Hide XML' : 'Show XML'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {expandedId !== null && detail && (
        <div className="border-t border-gray-200 p-4 dark:border-gray-700">
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Deadlock XML</h4>
          <pre className="max-h-64 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {detail.deadlock_xml}
          </pre>
        </div>
      )}
    </div>
  );
}
