import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';

type SortOption = 'cpu' | 'reads' | 'duration' | 'executions';
type TimeRange = '1h' | '6h' | '24h';

interface QueryRow {
  query_hash: string;
  statement_text: string | null;
  database_name: string | null;
  execution_count: number;
  cpu_ms_per_sec: number;
  elapsed_ms_per_sec: number;
  reads_per_sec: number;
  writes_per_sec: number;
  avg_cpu_ms: number;
  avg_elapsed_ms: number;
  avg_reads: number;
  avg_writes: number;
  sample_count: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.json();
}

export function QueryExplorer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sort, setSort] = useState<SortOption>('cpu');
  const [range, setRange] = useState<TimeRange>('1h');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [planData, setPlanData] = useState<Record<string, string | null>>({});
  const [planLoading, setPlanLoading] = useState<string | null>(null);

  const { data: queries = [], isLoading } = useQuery<QueryRow[]>({
    queryKey: ['queries', id, sort, range],
    queryFn: () => fetchJson(`/api/queries/${id}?sort=${sort}&range=${range}&limit=50`),
    refetchInterval: 30000,
  });

  const ranges: TimeRange[] = ['1h', '6h', '24h'];
  const sorts: { value: SortOption; label: string }[] = [
    { value: 'cpu', label: 'CPU' },
    { value: 'reads', label: 'Reads' },
    { value: 'duration', label: 'Duration' },
    { value: 'executions', label: 'Executions' },
  ];

  async function fetchPlan(hash: string) {
    setPlanLoading(hash);
    try {
      const data = await fetchJson<{ plan: string | null; message?: string }>(`/api/queries/${id}/${hash}/plan`);
      setPlanData((prev) => ({ ...prev, [hash]: data.plan ?? data.message ?? 'No plan available' }));
    } catch {
      setPlanData((prev) => ({ ...prev, [hash]: 'Failed to retrieve plan' }));
    } finally {
      setPlanLoading(null);
    }
  }

  function truncate(text: string | null, len: number): string {
    if (!text) return '-';
    return text.length > len ? text.slice(0, len) + '...' : text;
  }

  function fmt(n: number, decimals = 1): string {
    return n.toFixed(decimals);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(`/instances/${id}`)}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          title="Back to Instance"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
        </button>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Query Explorer</h2>
      </div>

      {/* Controls */}
      <div className="mt-4 flex gap-4 items-center">
        <div className="flex gap-1">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                range === r
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <span className="text-sm text-gray-500 dark:text-gray-400">Sort by:</span>
        <div className="flex gap-1">
          {sorts.map((s) => (
            <button
              key={s.value}
              onClick={() => setSort(s.value)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                sort === s.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="mt-6 text-gray-500 dark:text-gray-400">Loading...</div>
      ) : queries.length === 0 ? (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
          <p className="text-gray-500 dark:text-gray-400">No query stats data available yet.</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Query stats are collected every 60 seconds. Wait for at least 2 collection cycles.</p>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <table className="w-full text-sm text-left">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2">Statement</th>
                <th className="px-3 py-2">Database</th>
                <th className="px-3 py-2 text-right">CPU ms/s</th>
                <th className="px-3 py-2 text-right">Reads/s</th>
                <th className="px-3 py-2 text-right">Exec/s</th>
                <th className="px-3 py-2 text-right">Avg CPU</th>
                <th className="px-3 py-2 text-right">Avg Reads</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {queries.map((q) => (
                <tr key={q.query_hash} className="group">
                  <td colSpan={7} className="p-0">
                    {/* Summary row */}
                    <div
                      className="flex cursor-pointer items-center px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                      onClick={() => setExpanded(expanded === q.query_hash ? null : q.query_hash)}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-mono text-xs text-gray-700 dark:text-gray-300 block truncate max-w-[400px]">
                          {truncate(q.statement_text, 200)}
                        </span>
                      </div>
                      <span className="w-20 text-right text-xs text-gray-600 dark:text-gray-400 shrink-0">{q.database_name ?? '-'}</span>
                      <span className="w-20 text-right text-xs font-medium text-gray-900 dark:text-gray-100 shrink-0">{fmt(q.cpu_ms_per_sec)}</span>
                      <span className="w-20 text-right text-xs text-gray-700 dark:text-gray-300 shrink-0">{fmt(q.reads_per_sec, 0)}</span>
                      <span className="w-20 text-right text-xs text-gray-700 dark:text-gray-300 shrink-0">{fmt(q.execution_count / Math.max(q.sample_count, 1), 1)}</span>
                      <span className="w-20 text-right text-xs text-gray-700 dark:text-gray-300 shrink-0">{fmt(q.avg_cpu_ms)}</span>
                      <span className="w-20 text-right text-xs text-gray-700 dark:text-gray-300 shrink-0">{fmt(q.avg_reads, 0)}</span>
                    </div>

                    {/* Expanded detail */}
                    {expanded === q.query_hash && (
                      <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-800/50">
                        <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">Full SQL Statement</div>
                        <pre className="max-h-48 overflow-auto rounded bg-gray-100 p-3 text-xs font-mono text-gray-800 dark:bg-gray-900 dark:text-gray-300 whitespace-pre-wrap">
                          {q.statement_text ?? 'No statement text available'}
                        </pre>
                        <div className="mt-3 flex items-center gap-3">
                          <button
                            onClick={(e) => { e.stopPropagation(); fetchPlan(q.query_hash); }}
                            disabled={planLoading === q.query_hash}
                            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {planLoading === q.query_hash ? 'Loading Plan...' : 'View Plan'}
                          </button>
                          <span className="text-xs text-gray-400 dark:text-gray-500">Hash: {q.query_hash}</span>
                        </div>
                        {planData[q.query_hash] && (
                          <div className="mt-3">
                            <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Execution Plan (XML)</div>
                            <pre className="max-h-64 overflow-auto rounded bg-gray-100 p-3 text-xs font-mono text-gray-700 dark:bg-gray-900 dark:text-gray-400 whitespace-pre-wrap">
                              {planData[q.query_hash]}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
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
