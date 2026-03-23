import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';
import type { TimeWindow } from '@/components/OverviewTimeline';

type AnalysisTab = 'top-queries' | 'tracked-queries' | 'top-waits' | 'top-procedures';
type QueryMode = 'avg' | 'totals' | 'impact';

interface AnalysisSectionProps {
  instanceId: string;
  range: string;
  timeWindow: TimeWindow | null;
}

interface QueryRow {
  query_hash: string;
  statement_text: string;
  database_name: string;
  execution_count: number;
  cpu_ms_per_sec: number;
  elapsed_ms_per_sec: number;
  reads_per_sec: number;
  writes_per_sec: number;
  avg_cpu_ms: number;
  avg_elapsed_ms: number;
  avg_reads: number;
  avg_writes: number;
  total_cpu_ms: number;
  total_elapsed_ms: number;
  total_reads: number;
  total_writes: number;
  sample_count: number;
}

interface WaitRow {
  wait_type: string;
  waiting_tasks_count: number;
  wait_time_ms: number;
  max_wait_time_ms: number;
  signal_wait_time_ms: number;
  wait_ms_per_sec: number;
}

interface ProcedureRow {
  database_name: string;
  procedure_name: string;
  execution_count: number;
  total_cpu_ms: number;
  total_elapsed_ms: number;
  total_reads: number;
  total_writes: number;
  avg_cpu_ms: number;
  avg_elapsed_ms: number;
  avg_reads: number;
  last_execution_time: string;
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
        active
          ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-b-0 border-gray-200 dark:border-gray-700'
          : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
      }`}
    >
      {children}
    </button>
  );
}

function ImpactDot({ score }: { score: number }) {
  if (score >= 90) return <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" title={`Impact: ${score.toFixed(0)}`} />;
  if (score >= 70) return <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400" title={`Impact: ${score.toFixed(0)}`} />;
  return <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-300 dark:bg-gray-600" title={`Impact: ${score.toFixed(0)}`} />;
}

function formatNum(v: number, decimals = 1): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(decimals)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(decimals)}k`;
  return v.toFixed(decimals);
}

// --- Top Queries Tab ---
function TopQueriesTab({ instanceId, range, timeWindow }: { instanceId: string; range: string; timeWindow: TimeWindow | null }) {
  const [mode, setMode] = useState<QueryMode>('avg');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(25);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);

  const params = timeWindow
    ? `from=${encodeURIComponent(timeWindow.from)}&to=${encodeURIComponent(timeWindow.to)}&limit=${limit}`
    : `range=${range}&limit=${limit}`;

  const { data: queries = [], isLoading } = useQuery<QueryRow[]>({
    queryKey: ['analysis-queries', instanceId, range, timeWindow, limit],
    queryFn: async () => {
      const res = await authFetch(`/api/queries/${instanceId}?${params}&sort=duration`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Impact scores
  const impactScores = useMemo(() => {
    if (queries.length === 0) return new Map<string, number>();
    const raw = queries.map(q => ({
      hash: q.query_hash,
      score: (q.total_cpu_ms * 0.4) + (q.total_reads * 0.4) + (q.execution_count * 0.2),
    }));
    const maxScore = Math.max(...raw.map(r => r.score), 1);
    return new Map(raw.map(r => [r.hash, (r.score / maxScore) * 100]));
  }, [queries]);

  const filtered = search
    ? queries.filter(q => q.statement_text?.toLowerCase().includes(search.toLowerCase()) || q.database_name?.toLowerCase().includes(search.toLowerCase()))
    : queries;

  const sortedQueries = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (mode === 'avg') return b.avg_elapsed_ms - a.avg_elapsed_ms;
      if (mode === 'totals') return b.total_elapsed_ms - a.total_elapsed_ms;
      return (impactScores.get(b.query_hash) ?? 0) - (impactScores.get(a.query_hash) ?? 0);
    });
  }, [filtered, mode, impactScores]);

  return (
    <div data-testid="top-queries-tab">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-1">
          <ToggleBtn active={mode === 'avg'} onClick={() => setMode('avg')}>Avg per execution</ToggleBtn>
          <ToggleBtn active={mode === 'totals'} onClick={() => setMode('totals')}>Totals</ToggleBtn>
          <ToggleBtn active={mode === 'impact'} onClick={() => setMode('impact')}>Impact</ToggleBtn>
        </div>
        <input
          type="text"
          placeholder="Search queries..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 w-48"
        />
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading queries...</div>
      ) : sortedQueries.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4">No query data available for this period.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <tr>
                {mode === 'impact' && <th className="py-1.5 pr-2 w-8"></th>}
                <th className="py-1.5 pr-3">Query</th>
                <th className="py-1.5 pr-2 text-right">Execs</th>
                <th className="py-1.5 pr-2 text-right">{mode === 'avg' ? 'Avg Duration' : 'Duration'}</th>
                <th className="py-1.5 pr-2 text-right">{mode === 'avg' ? 'Avg CPU' : 'CPU ms'}</th>
                <th className="py-1.5 pr-2 text-right">{mode === 'avg' ? 'Avg Reads' : 'Reads'}</th>
                <th className="py-1.5 pr-2 text-right">{mode === 'avg' ? 'Avg Writes' : 'Writes'}</th>
                <th className="py-1.5 text-right">Database</th>
              </tr>
            </thead>
            <tbody>
              {sortedQueries.map((q) => {
                const isExpanded = expandedHash === q.query_hash;
                return (
                  <tr
                    key={q.query_hash}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                    onClick={() => setExpandedHash(isExpanded ? null : q.query_hash)}
                  >
                    {mode === 'impact' && (
                      <td className="py-1.5 pr-2"><ImpactDot score={impactScores.get(q.query_hash) ?? 0} /></td>
                    )}
                    <td className="py-1.5 pr-3 font-mono text-gray-700 dark:text-gray-300 max-w-[300px]">
                      {isExpanded ? (
                        <div className="whitespace-pre-wrap break-all">{q.statement_text}</div>
                      ) : (
                        <div className="truncate" title={q.statement_text}>{q.statement_text}</div>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-medium text-gray-900 dark:text-gray-100">{formatNum(q.execution_count, 0)}</td>
                    <td className="py-1.5 pr-2 text-right font-medium text-gray-900 dark:text-gray-100">
                      {mode === 'avg' ? `${q.avg_elapsed_ms.toFixed(1)}ms` : formatNum(q.total_elapsed_ms, 0)}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">
                      {mode === 'avg' ? `${q.avg_cpu_ms.toFixed(1)}ms` : formatNum(q.total_cpu_ms, 0)}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">
                      {mode === 'avg' ? formatNum(q.avg_reads) : formatNum(q.total_reads, 0)}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">
                      {mode === 'avg' ? formatNum(q.avg_writes) : formatNum(q.total_writes, 0)}
                    </td>
                    <td className="py-1.5 text-right text-gray-500 dark:text-gray-400">{q.database_name}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Top Waits Tab ---
function TopWaitsTab({ instanceId, range, timeWindow }: { instanceId: string; range: string; timeWindow: TimeWindow | null }) {
  const [useZoom, setUseZoom] = useState(true);

  const params = useZoom && timeWindow
    ? `from=${encodeURIComponent(timeWindow.from)}&to=${encodeURIComponent(timeWindow.to)}`
    : `range=${range}`;

  const { data: waits = [], isLoading } = useQuery<WaitRow[]>({
    queryKey: ['analysis-waits', instanceId, range, timeWindow, useZoom],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/waits?${params}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  return (
    <div data-testid="top-waits-tab">
      <div className="flex items-center gap-2 mb-3">
        <ToggleBtn active={useZoom} onClick={() => setUseZoom(true)}>Zoom Range</ToggleBtn>
        <ToggleBtn active={!useZoom} onClick={() => setUseZoom(false)}>Full Range</ToggleBtn>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading waits...</div>
      ) : waits.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4">No wait data available.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="py-1.5 pr-3">Wait Type</th>
                <th className="py-1.5 pr-2 text-right">Tasks</th>
                <th className="py-1.5 pr-2 text-right">Wait Time ms</th>
                <th className="py-1.5 pr-2 text-right">Avg ms</th>
                <th className="py-1.5 pr-2 text-right">Signal ms</th>
                <th className="py-1.5 text-right">ms/s</th>
              </tr>
            </thead>
            <tbody>
              {waits.map((w) => (
                <tr key={w.wait_type} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-1.5 pr-3 font-mono text-gray-700 dark:text-gray-300">{w.wait_type}</td>
                  <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{formatNum(w.waiting_tasks_count, 0)}</td>
                  <td className="py-1.5 pr-2 text-right font-medium text-gray-900 dark:text-gray-100">{formatNum(w.wait_time_ms, 0)}</td>
                  <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">
                    {w.waiting_tasks_count > 0 ? (w.wait_time_ms / w.waiting_tasks_count).toFixed(1) : '0'}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{formatNum(w.signal_wait_time_ms, 0)}</td>
                  <td className="py-1.5 text-right font-medium text-gray-900 dark:text-gray-100">{w.wait_ms_per_sec.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Top Procedures Tab ---
function TopProceduresTab({ instanceId }: { instanceId: string }) {
  const { data: procs = [], isLoading } = useQuery<ProcedureRow[]>({
    queryKey: ['analysis-procedures', instanceId],
    queryFn: async () => {
      const res = await authFetch(`/api/queries/${instanceId}/procedures?limit=50`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 60_000,
  });

  return (
    <div data-testid="top-procedures-tab">
      {isLoading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading procedures...</div>
      ) : procs.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4">No procedure data available.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="py-1.5 pr-3">Procedure</th>
                <th className="py-1.5 pr-2 text-right">Execs</th>
                <th className="py-1.5 pr-2 text-right">Avg CPU ms</th>
                <th className="py-1.5 pr-2 text-right">Avg Duration ms</th>
                <th className="py-1.5 pr-2 text-right">Avg Reads</th>
                <th className="py-1.5 pr-2 text-right">Total CPU ms</th>
                <th className="py-1.5 text-right">Total Duration ms</th>
              </tr>
            </thead>
            <tbody>
              {procs.map((p) => (
                <tr key={`${p.database_name}-${p.procedure_name}`} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-1.5 pr-3 font-mono text-gray-700 dark:text-gray-300" title={`${p.database_name}.${p.procedure_name}`}>
                    <div className="truncate max-w-[250px]">{p.procedure_name}</div>
                  </td>
                  <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{formatNum(p.execution_count, 0)}</td>
                  <td className="py-1.5 pr-2 text-right font-medium text-gray-900 dark:text-gray-100">{Number(p.avg_cpu_ms).toFixed(1)}</td>
                  <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{Number(p.avg_elapsed_ms).toFixed(1)}</td>
                  <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{formatNum(Number(p.avg_reads))}</td>
                  <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{formatNum(p.total_cpu_ms, 0)}</td>
                  <td className="py-1.5 text-right text-gray-700 dark:text-gray-300">{formatNum(p.total_elapsed_ms, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Tracked Queries Tab (placeholder) ---
function TrackedQueriesTab() {
  return (
    <div className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center" data-testid="tracked-queries-tab">
      No tracked queries yet. Pin a query from Top Queries to track it.
    </div>
  );
}

// --- Main Analysis Section ---
export function AnalysisSection({ instanceId, range, timeWindow }: AnalysisSectionProps) {
  const [tab, setTab] = useState<AnalysisTab>('top-queries');

  return (
    <div className="mt-4" data-testid="analysis-section">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Analysis</h3>

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 border-b border-gray-200 dark:border-gray-700">
        <TabBtn active={tab === 'top-queries'} onClick={() => setTab('top-queries')}>Top Queries</TabBtn>
        <TabBtn active={tab === 'tracked-queries'} onClick={() => setTab('tracked-queries')}>Tracked Queries</TabBtn>
        <TabBtn active={tab === 'top-waits'} onClick={() => setTab('top-waits')}>Top Waits</TabBtn>
        <TabBtn active={tab === 'top-procedures'} onClick={() => setTab('top-procedures')}>Top Procedures</TabBtn>
      </div>

      {/* Tab content */}
      <div className="rounded-b-lg border border-t-0 border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        {tab === 'top-queries' && <TopQueriesTab instanceId={instanceId} range={range} timeWindow={timeWindow} />}
        {tab === 'tracked-queries' && <TrackedQueriesTab />}
        {tab === 'top-waits' && <TopWaitsTab instanceId={instanceId} range={range} timeWindow={timeWindow} />}
        {tab === 'top-procedures' && <TopProceduresTab instanceId={instanceId} />}
      </div>
    </div>
  );
}
