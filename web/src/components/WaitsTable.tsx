import { useState } from 'react';

interface WaitRow {
  wait_type: string;
  waiting_tasks_count: number;
  wait_time_ms: number;
  max_wait_time_ms: number;
  signal_wait_time_ms: number;
  wait_ms_per_sec: number;
}

interface WaitsTableProps {
  data: WaitRow[];
}

type SortField = 'wait_ms_per_sec' | 'wait_time_ms' | 'waiting_tasks_count' | 'max_wait_time_ms';

export function WaitsTable({ data }: WaitsTableProps) {
  const [sortBy, setSortBy] = useState<SortField>('wait_ms_per_sec');
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = [...data].sort((a, b) => {
    const diff = a[sortBy] - b[sortBy];
    return sortDesc ? -diff : diff;
  });

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortDesc(!sortDesc);
    } else {
      setSortBy(field);
      setSortDesc(true);
    }
  }

  function sortIndicator(field: SortField) {
    if (sortBy !== field) return '';
    return sortDesc ? ' \u25BC' : ' \u25B2';
  }

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Top Wait Types</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">No wait stats data available</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Top Wait Types</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2">Wait Type</th>
              <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => toggleSort('wait_ms_per_sec')}>
                ms/sec{sortIndicator('wait_ms_per_sec')}
              </th>
              <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => toggleSort('wait_time_ms')}>
                Total ms{sortIndicator('wait_time_ms')}
              </th>
              <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => toggleSort('waiting_tasks_count')}>
                Tasks{sortIndicator('waiting_tasks_count')}
              </th>
              <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => toggleSort('max_wait_time_ms')}>
                Max ms{sortIndicator('max_wait_time_ms')}
              </th>
              <th className="px-3 py-2 text-right">Signal ms</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {sorted.map((row) => (
              <tr key={row.wait_type} className="hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300">
                <td className="px-3 py-2 font-mono text-xs">{row.wait_type}</td>
                <td className="px-3 py-2 text-right font-medium">{row.wait_ms_per_sec.toFixed(1)}</td>
                <td className="px-3 py-2 text-right">{row.wait_time_ms.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{row.waiting_tasks_count.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{row.max_wait_time_ms.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{row.signal_wait_time_ms.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
