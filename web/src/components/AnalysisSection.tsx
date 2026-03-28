import { useState, useMemo, useCallback, Fragment } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { authFetch } from '@/lib/auth';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import type { TimeWindow } from '@/components/OverviewTimeline';

type AnalysisTab = 'top-queries' | 'tracked-queries' | 'top-procedures';
type QueryMode = 'avg' | 'totals' | 'impact';
type SortDir = 'asc' | 'desc';

interface AnalysisSectionProps {
  instanceId: string;
  range: string;
  timeWindow: TimeWindow | null;
}

export interface QueryRow {
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
  last_grant_kb: number | null;
  last_used_grant_kb: number | null;
}

interface TrackedQueryRow extends QueryRow {
  label: string | null;
  tracked_at: string;
  tracked_by: string | null;
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
  sample_count: number;
}

interface ProcedureStatement {
  statement_start_offset: number;
  statement_text: string;
  execution_count: number;
  total_cpu_ms: number;
  total_elapsed_ms: number;
  physical_reads: number;
  logical_reads: number;
  logical_writes: number;
  avg_cpu_ms: number;
  avg_elapsed_ms: number;
  last_execution_time: string;
  min_grant_kb: number | null;
  last_grant_kb: number | null;
}

interface QueryTimeSeries {
  collected_at: string;
  cpu_ms_per_sec: number;
  elapsed_ms_per_sec: number;
  reads_per_sec: number;
  execution_count_delta: number;
  avg_cpu_ms: number;
  avg_reads: number;
}

// --- Shared UI ---

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

function formatNum(v: number | null | undefined, decimals = 1): string {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(decimals)}k`;
  return n.toFixed(decimals);
}

function SortArrow({ dir }: { dir: SortDir }) {
  return <span className="inline-block ml-0.5 text-blue-400">{dir === 'desc' ? '\u25BE' : '\u25B4'}</span>;
}

function SortTh({ column, current, dir, onSort, children, className = '' }: {
  column: string; current: string; dir: SortDir; onSort: (col: string) => void; children: React.ReactNode; className?: string;
}) {
  return (
    <th className={`py-1.5 pr-2 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 whitespace-nowrap ${className}`} onClick={() => onSort(column)}>
      {children}{current === column && <SortArrow dir={dir} />}
    </th>
  );
}

function useSort<T>(defaultCol: string, defaultDir: SortDir = 'desc') {
  const [sortCol, setSortCol] = useState(defaultCol);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);
  const toggle = useCallback((col: string) => {
    if (col === sortCol) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  }, [sortCol]);
  const compare = useCallback((a: T, b: T) => {
    const av = (a as Record<string, unknown>)[sortCol];
    const bv = (b as Record<string, unknown>)[sortCol];
    // Parse numeric strings (SQL Server bigint comes as string via tedious)
    const toNum = (v: unknown): number | string => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const n = Number(v);
        return isNaN(n) ? v.toLowerCase() : n;
      }
      return 0;
    };
    const an = toNum(av);
    const bn = toNum(bv);
    if (an < bn) return sortDir === 'asc' ? -1 : 1;
    if (an > bn) return sortDir === 'asc' ? 1 : -1;
    return 0;
  }, [sortCol, sortDir]);
  return { sortCol, sortDir, toggle, compare };
}

// Wait type descriptions (common SQL Server waits)
const WAIT_DESCRIPTIONS: Record<string, string> = {
  PAGEIOLATCH_SH: 'Waiting for a data page to be read from disk into memory.',
  PAGEIOLATCH_EX: 'Waiting for a data page to be read from disk (exclusive).',
  PAGELATCH_SH: 'Waiting for access to in-memory pages.',
  PAGELATCH_EX: 'Waiting for access to in-memory pages (exclusive).',
  WRITELOG: 'Waiting for transaction log flush to disk.',
  SOS_SCHEDULER_YIELD: 'Query yielded the scheduler — high CPU usage.',
  CXPACKET: 'Waiting for parallel query threads to synchronize.',
  CXCONSUMER: 'Consumer side of parallel exchange waiting for rows.',
  LCK_M_S: 'Waiting to acquire a shared lock.',
  LCK_M_X: 'Waiting to acquire an exclusive lock.',
  LCK_M_U: 'Waiting to acquire an update lock.',
  LCK_M_IX: 'Waiting to acquire an intent exclusive lock.',
  LCK_M_IS: 'Waiting to acquire an intent shared lock.',
  ASYNC_NETWORK_IO: 'Waiting for client to consume result set data.',
  OLEDB: 'Waiting for OLEDB provider call (linked server or OPENQUERY).',
  CMEMTHREAD: 'Waiting for thread-safe memory allocation.',
  IO_COMPLETION: 'Waiting for non-data-page I/O operations to complete.',
  RESOURCE_SEMAPHORE: 'Waiting for memory grant to execute query.',
  MEMORY_ALLOCATION_EXT: 'Waiting for internal memory allocation.',
  LATCH_EX: 'Waiting for exclusive non-page latch.',
  LATCH_SH: 'Waiting for shared non-page latch.',
};

function getWaitDescription(waitType: string): string {
  return WAIT_DESCRIPTIONS[waitType] || 'See MSDN for this wait description.';
}

export interface PlanWaitStat {
  waitType: string;
  waitTimeMs: number;
  waitCount: number;
}

export function parseWaitStats(planXml: string): PlanWaitStat[] {
  const results: PlanWaitStat[] = [];
  // Match <Wait> elements inside <WaitStats> sections, handling optional namespace prefixes
  const waitStatsRegex = /<[\w:]*WaitStats\b[^>]*>([\s\S]*?)<\/[\w:]*WaitStats>/gi;
  let wsMatch: RegExpExecArray | null;
  while ((wsMatch = waitStatsRegex.exec(planXml)) !== null) {
    const block = wsMatch[1];
    const waitRegex = /<[\w:]*Wait\b\s+([^>]*?)\/?\s*>/gi;
    let wMatch: RegExpExecArray | null;
    while ((wMatch = waitRegex.exec(block)) !== null) {
      const attrs = wMatch[1];
      const typeMatch = /WaitType\s*=\s*"([^"]*)"/i.exec(attrs);
      const timeMatch = /WaitTimeMs\s*=\s*"([^"]*)"/i.exec(attrs);
      const countMatch = /WaitCount\s*=\s*"([^"]*)"/i.exec(attrs);
      if (typeMatch) {
        results.push({
          waitType: typeMatch[1],
          waitTimeMs: timeMatch ? Number(timeMatch[1]) : 0,
          waitCount: countMatch ? Number(countMatch[1]) : 0,
        });
      }
    }
  }
  // Deduplicate by waitType (sum values), then sort descending by waitTimeMs
  const merged = new Map<string, PlanWaitStat>();
  for (const w of results) {
    const existing = merged.get(w.waitType);
    if (existing) {
      existing.waitTimeMs += w.waitTimeMs;
      existing.waitCount += w.waitCount;
    } else {
      merged.set(w.waitType, { ...w });
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.waitTimeMs - a.waitTimeMs);
}

interface WaitInfo {
  wait_type: string;
  wait_time_ms: number;
  waiting_tasks_count: number;
  max_wait_time_ms: number;
  login_name: string;
  program_name: string;
}

interface CurrentRequest {
  wait_type: string | null;
  wait_time_ms: number;
  last_wait_type: string;
  login_name: string;
  program_name: string;
  memory_grant_kb: number | null;
  used_memory_kb: number | null;
  requested_memory_kb: number | null;
}

interface QueryWaitsData {
  session_waits: WaitInfo[];
  current_requests: CurrentRequest[];
  message?: string;
}

// --- Query Detail Panel (shown below the row when expanded) ---
export function QueryDetailPanel({ instanceId, query, range, timeWindow, onTrack, onUntrack, isTracked }: {
  instanceId: string;
  query: QueryRow;
  range: string;
  timeWindow: TimeWindow | null;
  onTrack?: (q: QueryRow) => void;
  onUntrack?: (hash: string) => void;
  isTracked?: boolean;
}) {
  const [planXml, setPlanXml] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planType, setPlanType] = useState<'estimated' | 'actual' | null>(null);
  const [planSource, setPlanSource] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: timeSeries = [] } = useQuery<QueryTimeSeries[]>({
    queryKey: ['query-timeseries', instanceId, query.query_hash, range, timeWindow],
    queryFn: async () => {
      const tsParams = timeWindow
        ? `from=${encodeURIComponent(timeWindow.from)}&to=${encodeURIComponent(timeWindow.to)}`
        : `range=${range}`;
      const res = await authFetch(`/api/queries/${instanceId}/${encodeURIComponent(query.query_hash)}?${tsParams}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Per-query wait stats are available in actual execution plans (cached in query_plans table)
  // or via Current Activity for running queries. No live SQL Server call on History tab.

  const chartData = useMemo(() => timeSeries.map(p => ({
    time: new Date(p.collected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    cpu: Number(p.cpu_ms_per_sec),
    duration: Number(p.elapsed_ms_per_sec),
    reads: Number(p.reads_per_sec),
    execsPerMin: Number(p.execution_count_delta) * (60 / 30),
  })), [timeSeries]);

  async function fetchPlan(type: 'estimated' | 'actual', force = false) {
    setPlanLoading(true);
    setPlanType(type);
    setPlanSource(null);
    try {
      const endpoint = type === 'estimated' ? 'plan' : 'actual-plan';
      const forceParam = force ? '?force=true' : '';
      const res = await authFetch(`/api/queries/${instanceId}/${encodeURIComponent(query.query_hash)}/${endpoint}${forceParam}`);
      const data = await res.json();
      setPlanXml(data.plan ?? data.message ?? data.error ?? 'No plan available');
      setPlanSource(data.source ?? null);
    } catch {
      setPlanXml('Failed to retrieve plan');
    } finally {
      setPlanLoading(false);
    }
  }

  function copyQueryText() {
    navigator.clipboard.writeText(query.statement_text || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 px-4 py-3 space-y-3">
      {/* Header row: database, hash, actions */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            <span>Database: <span className="font-medium text-gray-700 dark:text-gray-300">{query.database_name || 'N/A'}</span></span>
            <span>Hash: <span className="font-mono text-gray-600 dark:text-gray-400">{query.query_hash}</span></span>
            <span>Samples: <span className="font-medium text-gray-700 dark:text-gray-300">{query.sample_count}</span></span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onTrack && !isTracked && (
            <button onClick={() => onTrack(query)} className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 transition-colors">
              Track Query
            </button>
          )}
          {onUntrack && isTracked && (
            <button onClick={() => onUntrack(query.query_hash)} className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 transition-colors">
              Untrack
            </button>
          )}
        </div>
      </div>

      {/* SQL Statement */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400">SQL Statement</div>
          <button
            onClick={copyQueryText}
            className="text-xs text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
          >
            {copied ? 'Copied!' : 'Copy query text'}
          </button>
        </div>
        <pre className="max-h-40 overflow-auto rounded bg-gray-100 dark:bg-gray-900 p-3 text-xs font-mono text-gray-800 dark:text-gray-300 whitespace-pre-wrap break-all border border-gray-200 dark:border-gray-700">
          {query.statement_text || 'No statement text available'}
        </pre>
      </div>

      {/* Plan buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => fetchPlan('estimated')}
          disabled={planLoading}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {planLoading && planType === 'estimated' ? 'Loading...' : 'View estimated plan'}
        </button>
        <button
          onClick={() => fetchPlan('actual')}
          disabled={planLoading}
          className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {planLoading && planType === 'actual' ? 'Loading...' : 'View actual plan'}
        </button>
      </div>

      {/* Plan XML display */}
      {planXml && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400">
              {planType === 'actual' ? 'Actual' : 'Estimated'} Execution Plan (XML)
            </div>
            {planSource === 'cached' && (
              <>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">cached</span>
                <button
                  onClick={() => fetchPlan(planType!, true)}
                  disabled={planLoading}
                  className="text-[10px] text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50"
                >
                  Refresh from server
                </button>
              </>
            )}
            {planSource === 'live' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">live</span>
            )}
            <button
              onClick={() => { navigator.clipboard.writeText(planXml); }}
              className="text-[10px] text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 ml-auto"
              title="Copy plan XML to clipboard"
            >
              Copy plan XML
            </button>
          </div>
          <pre className="max-h-48 overflow-auto rounded bg-gray-100 dark:bg-gray-900 p-3 text-xs font-mono text-gray-700 dark:text-gray-400 whitespace-pre-wrap break-all border border-gray-200 dark:border-gray-700">
            {planXml}
          </pre>
        </div>
      )}

      {/* Wait types — parsed from actual execution plan XML */}
      <div>
        <div className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400 mb-1">Wait types for this query</div>
        {planType !== 'actual' || !planXml ? (
          <div className="text-xs text-gray-500 dark:text-gray-400 py-3 text-center border border-gray-200 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-800/30">
            Fetch actual plan to view wait statistics
          </div>
        ) : (() => {
          const waits = parseWaitStats(planXml);
          if (waits.length === 0) return (
            <div className="text-xs text-gray-500 dark:text-gray-400 py-3 text-center border border-gray-200 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-800/30">
              No wait statistics recorded for this query execution. Waits appear when a query encounters resource contention.
            </div>
          );
          return (
            <div className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-left">
                    <th className="py-1.5 px-2 font-medium">Wait Type</th>
                    <th className="py-1.5 px-2 font-medium">Description</th>
                    <th className="py-1.5 px-2 font-medium text-right">Wait Time (ms)</th>
                    <th className="py-1.5 px-2 font-medium text-right">Wait Count</th>
                  </tr>
                </thead>
                <tbody>
                  {waits.map(w => (
                    <tr key={w.waitType} className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                      <td className="py-1.5 px-2 font-mono font-bold text-gray-900 dark:text-gray-100">{w.waitType}</td>
                      <td className="py-1.5 px-2 text-gray-600 dark:text-gray-400">{getWaitDescription(w.waitType)}</td>
                      <td className="py-1.5 px-2 text-right font-medium text-gray-900 dark:text-gray-100">{formatNum(w.waitTimeMs, 1)}</td>
                      <td className="py-1.5 px-2 text-right text-gray-700 dark:text-gray-300">{formatNum(w.waitCount, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* Memory grant */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 py-2">
          <div className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Used memory grant (KB)</div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{query.last_used_grant_kb != null ? formatNum(query.last_used_grant_kb, 0) : '0'}</div>
        </div>
        <div className="rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 py-2">
          <div className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Memory grant (KB)</div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{query.last_grant_kb != null ? formatNum(query.last_grant_kb, 0) : '0'}</div>
        </div>
      </div>

      {/* Metrics summary */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Avg CPU', value: `${query.avg_cpu_ms.toFixed(1)} ms` },
          { label: 'Avg Duration', value: `${query.avg_elapsed_ms.toFixed(1)} ms` },
          { label: 'Avg Reads', value: formatNum(query.avg_reads) },
          { label: 'Executions', value: formatNum(query.execution_count, 0) },
        ].map(m => (
          <div key={m.label} className="rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 py-2">
            <div className="text-[10px] uppercase text-gray-500 dark:text-gray-400">{m.label}</div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{m.value}</div>
          </div>
        ))}
      </div>

      {/* Time-series charts */}
      {chartData.length > 1 && (
        <div className="space-y-3">
          <div>
            <div className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400 mb-1">Performance over time</div>
            <div className="h-32 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: '#9CA3AF' }} width={40} />
                  <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 6, fontSize: 11 }} labelStyle={{ color: '#9CA3AF' }} />
                  <Line type="linear" dataKey="cpu" name="CPU ms/s" stroke="#3B82F6" strokeWidth={1.5} dot={false} />
                  <Line type="linear" dataKey="duration" name="Duration ms/s" stroke="#F59E0B" strokeWidth={1.5} dot={false} />
                  <Line type="linear" dataKey="reads" name="Reads/s" stroke="#10B981" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400 mb-1">Executions per minute</div>
            <div className="h-24 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: '#9CA3AF' }} width={40} />
                  <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 6, fontSize: 11 }} labelStyle={{ color: '#9CA3AF' }} formatter={(value: number) => [value.toFixed(1), 'Exec/min']} />
                  <Line type="linear" dataKey="execsPerMin" name="Exec/min" stroke="#8B5CF6" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Top Queries Tab ---
export function TopQueriesTab({ instanceId, range, timeWindow, onTrack, db }: { instanceId: string; range: string; timeWindow: TimeWindow | null; onTrack?: (q: QueryRow) => void; db?: string }) {
  const [mode, setMode] = useState<QueryMode>('totals');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(25);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const { sortCol, sortDir, toggle, compare } = useSort<QueryRow>('total_elapsed_ms');

  const { data: queries = [], isLoading } = useQuery<QueryRow[]>({
    queryKey: ['analysis-queries', instanceId, range, timeWindow, limit, db],
    queryFn: async () => {
      const params = timeWindow
        ? `from=${encodeURIComponent(timeWindow.from)}&to=${encodeURIComponent(timeWindow.to)}&limit=${limit}`
        : `range=${range}&limit=${limit}`;
      const dbParam = db ? `&db=${encodeURIComponent(db)}` : '';
      const res = await authFetch(`/api/queries/${instanceId}?${params}&sort=duration${dbParam}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

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

  const sortedQueries = useMemo(() => [...filtered].sort(compare), [filtered, compare]);

  const val = (q: QueryRow, totalKey: keyof QueryRow, avgKey: keyof QueryRow): string => {
    const v = mode === 'avg' ? Number(q[avgKey]) : Number(q[totalKey]);
    if (totalKey === 'total_elapsed_ms' || totalKey === 'total_cpu_ms') return mode === 'avg' ? v.toFixed(1) : formatNum(v, 0);
    return mode === 'avg' ? formatNum(v) : formatNum(v, 0);
  };

  const durationCol = mode === 'avg' ? 'avg_elapsed_ms' : 'total_elapsed_ms';
  const cpuCol = mode === 'avg' ? 'avg_cpu_ms' : 'total_cpu_ms';
  const readsCol = mode === 'avg' ? 'avg_reads' : 'total_reads';
  const writesCol = mode === 'avg' ? 'avg_writes' : 'total_writes';
  const colCount = (db ? 7 : 8) + (mode === 'impact' ? 1 : 0);

  return (
    <div data-testid="top-queries-tab">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-1">
          <ToggleBtn active={mode === 'totals'} onClick={() => setMode('totals')}>Totals</ToggleBtn>
          <ToggleBtn active={mode === 'avg'} onClick={() => setMode('avg')}>Avg per execution</ToggleBtn>
          <ToggleBtn active={mode === 'impact'} onClick={() => setMode('impact')}>Impact</ToggleBtn>
        </div>
        <input type="text" placeholder="Search queries..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 w-48" />
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
          className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
          <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
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
                <th className="py-1.5 pr-1 w-6">#</th>
                {mode === 'impact' && <th className="py-1.5 pr-2 w-8"></th>}
                <SortTh column="statement_text" current={sortCol} dir={sortDir} onSort={toggle} className="pr-3">Statement</SortTh>
                <SortTh column="execution_count" current={sortCol} dir={sortDir} onSort={toggle} className="text-right">Execution count</SortTh>
                <SortTh column={durationCol} current={sortCol} dir={sortDir} onSort={toggle} className="text-right">{mode === 'avg' ? 'Avg Duration (ms)' : 'Duration (ms)'}</SortTh>
                <SortTh column={cpuCol} current={sortCol} dir={sortDir} onSort={toggle} className="text-right">{mode === 'avg' ? 'Avg CPU time (ms)' : 'CPU time (ms)'}</SortTh>
                <SortTh column={readsCol} current={sortCol} dir={sortDir} onSort={toggle} className="text-right">{mode === 'avg' ? 'Avg Logical reads' : 'Logical reads'}</SortTh>
                <SortTh column={writesCol} current={sortCol} dir={sortDir} onSort={toggle} className="text-right">{mode === 'avg' ? 'Avg Logical writes' : 'Logical writes'}</SortTh>
                {!db && <SortTh column="database_name" current={sortCol} dir={sortDir} onSort={toggle} className="text-right">Database</SortTh>}
              </tr>
            </thead>
            <tbody>
              {sortedQueries.map((q, idx) => {
                const isExpanded = expandedHash === q.query_hash;
                return (
                  <Fragment key={q.query_hash}>
                    <tr
                      className={`border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer ${isExpanded ? 'bg-gray-50 dark:bg-gray-800/50' : ''}`}
                      onClick={() => setExpandedHash(isExpanded ? null : q.query_hash)}
                    >
                      <td className="py-1.5 pr-1 text-gray-400 dark:text-gray-500">{idx + 1}</td>
                      {mode === 'impact' && <td className="py-1.5 pr-2"><ImpactDot score={impactScores.get(q.query_hash) ?? 0} /></td>}
                      <td className="py-1.5 pr-3 font-mono text-gray-700 dark:text-gray-300 max-w-[400px]">
                        <div className="truncate">{q.statement_text}</div>
                      </td>
                      <td className="py-1.5 pr-2 text-right font-medium text-gray-900 dark:text-gray-100">{formatNum(q.execution_count, 0)}</td>
                      <td className="py-1.5 pr-2 text-right font-medium text-gray-900 dark:text-gray-100">{val(q, 'total_elapsed_ms', 'avg_elapsed_ms')}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{val(q, 'total_cpu_ms', 'avg_cpu_ms')}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{val(q, 'total_reads', 'avg_reads')}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{val(q, 'total_writes', 'avg_writes')}</td>
                      {!db && <td className="py-1.5 pr-2 text-right text-gray-500 dark:text-gray-400">{q.database_name || 'N/A'}</td>}
                    </tr>
                    {isExpanded && (
                      <tr key={`${q.query_hash}-detail`}>
                        <td colSpan={colCount} className="p-0">
                          <QueryDetailPanel instanceId={instanceId} query={q} range={range} timeWindow={timeWindow} onTrack={onTrack} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Tracked Queries Tab ---
function TrackedQueriesTab({ instanceId, range, timeWindow }: { instanceId: string; range: string; timeWindow: TimeWindow | null }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<QueryMode>('totals');
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const { sortCol, sortDir, toggle, compare } = useSort<TrackedQueryRow>('total_elapsed_ms');

  const { data: tracked = [], isLoading } = useQuery<TrackedQueryRow[]>({
    queryKey: ['tracked-queries', instanceId, range, timeWindow],
    queryFn: async () => {
      const params = timeWindow
        ? `from=${encodeURIComponent(timeWindow.from)}&to=${encodeURIComponent(timeWindow.to)}`
        : `range=${range}`;
      const res = await authFetch(`/api/queries/${instanceId}/tracked?${params}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
  });

  async function untrack(hash: string) {
    setRemoving(hash);
    try {
      await authFetch(`/api/queries/${instanceId}/tracked/${encodeURIComponent(hash)}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['tracked-queries', instanceId] });
    } finally {
      setRemoving(null);
    }
  }

  const sorted = useMemo(() => [...tracked].sort(compare), [tracked, compare]);

  const durationCol = mode === 'avg' ? 'avg_elapsed_ms' : 'total_elapsed_ms';
  const cpuCol = mode === 'avg' ? 'avg_cpu_ms' : 'total_cpu_ms';
  const readsCol = mode === 'avg' ? 'avg_reads' : 'total_reads';
  const writesCol = mode === 'avg' ? 'avg_writes' : 'total_writes';

  return (
    <div data-testid="tracked-queries-tab">
      {isLoading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading tracked queries...</div>
      ) : sorted.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
          No tracked queries yet. Click a query row in Top Queries, then click "Track Query" to start tracking it.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 mb-3">
            <ToggleBtn active={mode === 'totals'} onClick={() => setMode('totals')}>Totals</ToggleBtn>
            <ToggleBtn active={mode === 'avg'} onClick={() => setMode('avg')}>Avg per execution</ToggleBtn>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <SortTh column="statement_text" current={sortCol} dir={sortDir} onSort={toggle} className="pr-3">Statement</SortTh>
                  <SortTh column="execution_count" current={sortCol} dir={sortDir} onSort={toggle} className="text-right">Execution count</SortTh>
                  <SortTh column={durationCol} current={sortCol} dir={sortDir} onSort={toggle} className="text-right">{mode === 'avg' ? 'Avg Duration (ms)' : 'Duration (ms)'}</SortTh>
                  <SortTh column={cpuCol} current={sortCol} dir={sortDir} onSort={toggle} className="text-right">{mode === 'avg' ? 'Avg CPU time (ms)' : 'CPU time (ms)'}</SortTh>
                  <SortTh column={readsCol} current={sortCol} dir={sortDir} onSort={toggle} className="text-right">{mode === 'avg' ? 'Avg Logical reads' : 'Logical reads'}</SortTh>
                  <SortTh column={writesCol} current={sortCol} dir={sortDir} onSort={toggle} className="text-right">{mode === 'avg' ? 'Avg Logical writes' : 'Logical writes'}</SortTh>
                  <SortTh column="database_name" current={sortCol} dir={sortDir} onSort={toggle} className="text-right">Database</SortTh>
                </tr>
              </thead>
              <tbody>
                {sorted.map((q) => {
                  const isExpanded = expandedHash === q.query_hash;
                  const v = (totalKey: keyof QueryRow, avgKey: keyof QueryRow): string => {
                    const n = mode === 'avg' ? Number(q[avgKey]) : Number(q[totalKey]);
                    if (totalKey === 'total_elapsed_ms' || totalKey === 'total_cpu_ms') return mode === 'avg' ? n.toFixed(1) : formatNum(n, 0);
                    return mode === 'avg' ? formatNum(n) : formatNum(n, 0);
                  };
                  return (
                    <Fragment key={q.query_hash}>
                      <tr
                        className={`border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer ${isExpanded ? 'bg-gray-50 dark:bg-gray-800/50' : ''}`}
                        onClick={() => setExpandedHash(isExpanded ? null : q.query_hash)}
                      >
                        <td className="py-1.5 pr-3 font-mono text-gray-700 dark:text-gray-300 max-w-[400px]">
                          {q.label && <span className="text-[10px] text-blue-500 dark:text-blue-400 mr-2">[{q.label}]</span>}
                          <span className="truncate inline-block max-w-[350px] align-bottom">{q.statement_text}</span>
                        </td>
                        <td className="py-1.5 pr-2 text-right font-medium text-gray-900 dark:text-gray-100">{formatNum(q.execution_count, 0)}</td>
                        <td className="py-1.5 pr-2 text-right font-medium text-gray-900 dark:text-gray-100">{v('total_elapsed_ms', 'avg_elapsed_ms')}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{v('total_cpu_ms', 'avg_cpu_ms')}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{v('total_reads', 'avg_reads')}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{v('total_writes', 'avg_writes')}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-500 dark:text-gray-400">{q.database_name || 'N/A'}</td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${q.query_hash}-detail`}>
                          <td colSpan={7} className="p-0">
                            <QueryDetailPanel
                              instanceId={instanceId} query={q} range={range} timeWindow={timeWindow}
                              onUntrack={(hash) => { untrack(hash); setExpandedHash(null); }} isTracked
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// --- Procedure Detail Panel (shown below the row when expanded) ---
function ProcedureDetailPanel({ instanceId, procedure, range, timeWindow }: { instanceId: string; procedure: ProcedureRow; range: string; timeWindow: TimeWindow | null }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const { sortCol: stmtSortCol, sortDir: stmtSortDir, toggle: stmtToggle, compare: stmtCompare } = useSort<ProcedureStatement & { _seq: number }>('_seq', 'asc');

  // Compute from/to for the history endpoint
  const { from, to } = useMemo(() => {
    if (timeWindow) return { from: timeWindow.from, to: timeWindow.to };
    const now = new Date();
    const ms = range === '24h' ? 86400000 : range === '6h' ? 21600000 : 3600000;
    return { from: new Date(now.getTime() - ms).toISOString(), to: now.toISOString() };
  }, [range, timeWindow]);

  const { data: statements, isLoading, error } = useQuery<ProcedureStatement[]>({
    queryKey: ['procedure-statements-history', instanceId, procedure.database_name, procedure.procedure_name, from, to],
    queryFn: async () => {
      const res = await authFetch(
        `/api/queries/${instanceId}/procedure-statements-history?db=${encodeURIComponent(procedure.database_name)}&proc=${encodeURIComponent(procedure.procedure_name)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  // Assign fixed sequence numbers based on position in procedure (statement_start_offset order)
  const withSeq = useMemo(() => {
    if (!statements) return [];
    return [...statements]
      .sort((a, b) => a.statement_start_offset - b.statement_start_offset)
      .map((s, i) => ({ ...s, _seq: i + 1 }));
  }, [statements]);

  const sorted = useMemo(() => {
    return [...withSeq].sort(stmtCompare);
  }, [withSeq, stmtCompare]);

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 px-4 py-3 space-y-3">
      <div className="space-y-1">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Stored procedure details: <span className="font-semibold text-gray-900 dark:text-gray-100">{procedure.database_name}.{procedure.procedure_name}</span>
        </div>
        <div className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400">Top queries for this procedure</div>
      </div>

      {isLoading ? (
        <div className="text-xs text-gray-500 dark:text-gray-400 py-2">Loading statements...</div>
      ) : error ? (
        <div className="text-xs text-red-500 dark:text-red-400 py-2">Failed to load statement data.</div>
      ) : !sorted || sorted.length === 0 ? (
        <div className="text-xs text-gray-500 dark:text-gray-400 py-2">No statement data available.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <SortTh column="_seq" current={stmtSortCol} dir={stmtSortDir} onSort={stmtToggle} className="pr-1 w-10">Seq</SortTh>
                <th className="py-1.5 pr-3">Query text</th>
                <SortTh column="execution_count" current={stmtSortCol} dir={stmtSortDir} onSort={stmtToggle} className="text-right pr-2">Executions</SortTh>
                <SortTh column="total_cpu_ms" current={stmtSortCol} dir={stmtSortDir} onSort={stmtToggle} className="text-right pr-2">CPU (ms)</SortTh>
                <SortTh column="total_elapsed_ms" current={stmtSortCol} dir={stmtSortDir} onSort={stmtToggle} className="text-right pr-2">Duration (ms)</SortTh>
                <SortTh column="physical_reads" current={stmtSortCol} dir={stmtSortDir} onSort={stmtToggle} className="text-right pr-2">Phys reads</SortTh>
                <SortTh column="logical_reads" current={stmtSortCol} dir={stmtSortDir} onSort={stmtToggle} className="text-right pr-2">Log reads</SortTh>
                <SortTh column="logical_writes" current={stmtSortCol} dir={stmtSortDir} onSort={stmtToggle} className="text-right pr-2">Log writes</SortTh>
                <th className="py-1.5 text-right">Memory (KB)</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => {
                const isOpen = expandedIdx === i;
                return (
                  <Fragment key={i}>
                    <tr
                      className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 ${isOpen ? 'bg-gray-100 dark:bg-gray-700/50' : ''}`}
                      onClick={() => setExpandedIdx(isOpen ? null : i)}
                    >
                      <td className="py-1.5 pr-1 text-gray-400 dark:text-gray-500">{s._seq}</td>
                      <td className="py-1.5 pr-3 font-mono text-gray-700 dark:text-gray-300 max-w-[350px]">
                        <div className="truncate">{s.statement_text}</div>
                      </td>
                      <td className="py-1.5 pr-2 text-right font-medium text-gray-900 dark:text-gray-100">{formatNum(s.execution_count, 0)}</td>
                      <td className="py-1.5 pr-2 text-right font-medium text-gray-900 dark:text-gray-100">{formatNum(s.total_cpu_ms, 0)}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{formatNum(s.total_elapsed_ms, 0)}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{formatNum(s.physical_reads, 0)}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{formatNum(s.logical_reads, 0)}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{formatNum(s.logical_writes, 0)}</td>
                      <td className="py-1.5 text-right text-gray-500 dark:text-gray-400">{s.last_grant_kb != null ? formatNum(s.last_grant_kb, 0) : '-'}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={9} className="bg-gray-100 dark:bg-gray-700/30 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                          <div className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400 mb-1">Full statement text</div>
                          <pre className="whitespace-pre-wrap break-words text-xs font-mono text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 p-3 max-h-64 overflow-y-auto">{s.statement_text}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Top Procedures Tab ---
function TopProceduresTab({ instanceId, range, timeWindow }: { instanceId: string; range: string; timeWindow: TimeWindow | null }) {
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(25);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const { sortCol, sortDir, toggle, compare } = useSort<ProcedureRow>('total_cpu_ms');

  const { data: procs = [], isLoading, error } = useQuery<ProcedureRow[]>({
    queryKey: ['analysis-procedures', instanceId, range, timeWindow?.from, timeWindow?.to, limit],
    queryFn: async () => {
      const params = timeWindow
        ? `from=${encodeURIComponent(timeWindow.from)}&to=${encodeURIComponent(timeWindow.to)}&limit=${limit}`
        : `range=${range}&limit=${limit}`;
      const res = await authFetch(`/api/queries/${instanceId}/procedure-stats?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      return data;
    },
  });

  const filtered = useMemo(() => {
    if (!Array.isArray(procs)) return [];
    const base = search
      ? procs.filter(p => (p.procedure_name ?? '').toLowerCase().includes(search.toLowerCase()) || (p.database_name ?? '').toLowerCase().includes(search.toLowerCase()))
      : procs;
    return [...base].sort(compare);
  }, [procs, search, compare]);

  return (
    <div data-testid="top-procedures-tab">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <input type="text" placeholder="Search procedures..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 w-48" />
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
          className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
          <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
        </select>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading procedures...</div>
      ) : error ? (
        <div className="text-sm text-red-500 dark:text-red-400 py-4">Failed to load procedures. The SQL Server may be unreachable.</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4">No procedure data available.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="py-1.5 pr-1 w-6">#</th>
                <SortTh column="procedure_name" current={sortCol} dir={sortDir} onSort={toggle} className="pr-3">Procedure</SortTh>
                <SortTh column="database_name" current={sortCol} dir={sortDir} onSort={toggle} className="text-right">Database</SortTh>
                <SortTh column="execution_count" current={sortCol} dir={sortDir} onSort={toggle} className="text-right">Execution count</SortTh>
                <SortTh column="avg_cpu_ms" current={sortCol} dir={sortDir} onSort={toggle} className="text-right">Avg CPU (ms)</SortTh>
                <SortTh column="avg_elapsed_ms" current={sortCol} dir={sortDir} onSort={toggle} className="text-right">Avg Duration (ms)</SortTh>
                <SortTh column="avg_reads" current={sortCol} dir={sortDir} onSort={toggle} className="text-right">Avg Reads</SortTh>
                <SortTh column="total_cpu_ms" current={sortCol} dir={sortDir} onSort={toggle} className="text-right">Total CPU (ms)</SortTh>
                <SortTh column="total_elapsed_ms" current={sortCol} dir={sortDir} onSort={toggle} className="text-right">Total Duration (ms)</SortTh>
                <SortTh column="sample_count" current={sortCol} dir={sortDir} onSort={toggle} className="text-right">Samples</SortTh>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, idx) => {
                const rowKey = `${p.database_name}-${p.procedure_name}`;
                const isExpanded = expandedKey === rowKey;
                return (
                  <Fragment key={rowKey}>
                    <tr
                      className={`border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer ${isExpanded ? 'bg-gray-50 dark:bg-gray-800/50' : ''}`}
                      onClick={() => setExpandedKey(isExpanded ? null : rowKey)}
                    >
                      <td className="py-1.5 pr-1 text-gray-400 dark:text-gray-500">{idx + 1}</td>
                      <td className="py-1.5 pr-3 font-mono text-gray-700 dark:text-gray-300" title={`${p.database_name}.${p.procedure_name}`}>
                        <div className="truncate max-w-[250px]">{p.procedure_name}</div>
                      </td>
                      <td className="py-1.5 pr-2 text-right text-gray-500 dark:text-gray-400">{p.database_name}</td>
                      <td className="py-1.5 pr-2 text-right font-medium text-gray-900 dark:text-gray-100">{formatNum(p.execution_count, 0)}</td>
                      <td className="py-1.5 pr-2 text-right font-medium text-gray-900 dark:text-gray-100">{formatNum(p.avg_cpu_ms)}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{formatNum(p.avg_elapsed_ms)}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{formatNum(p.avg_reads)}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{formatNum(p.total_cpu_ms, 0)}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700 dark:text-gray-300">{formatNum(p.total_elapsed_ms, 0)}</td>
                      <td className="py-1.5 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {p.sample_count != null ? formatNum(p.sample_count, 0) : '-'}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={10} className="p-0">
                          <ProcedureDetailPanel instanceId={instanceId} procedure={p} range={range} timeWindow={timeWindow} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Main Analysis Section ---
export function AnalysisSection({ instanceId, range, timeWindow }: AnalysisSectionProps) {
  const [tab, setTab] = useState<AnalysisTab>('top-queries');
  const queryClient = useQueryClient();

  async function trackQuery(q: QueryRow) {
    await authFetch(`/api/queries/${instanceId}/tracked`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query_hash: q.query_hash,
        statement_text: q.statement_text,
        database_name: q.database_name,
      }),
    });
    queryClient.invalidateQueries({ queryKey: ['tracked-queries', instanceId] });
  }

  return (
    <CollapsibleSection title="Analysis" defaultOpen>
      <div data-testid="analysis-section">
        <div className="flex items-center gap-0.5 border-b border-gray-200 dark:border-gray-700">
          <TabBtn active={tab === 'top-queries'} onClick={() => setTab('top-queries')}>Top Queries</TabBtn>
          <TabBtn active={tab === 'tracked-queries'} onClick={() => setTab('tracked-queries')}>Tracked Queries</TabBtn>
          <TabBtn active={tab === 'top-procedures'} onClick={() => setTab('top-procedures')}>Top Procedures</TabBtn>
        </div>

        <div className="rounded-b-lg border border-t-0 border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          {tab === 'top-queries' && <TopQueriesTab instanceId={instanceId} range={range} timeWindow={timeWindow} onTrack={trackQuery} />}
          {tab === 'tracked-queries' && <TrackedQueriesTab instanceId={instanceId} range={range} timeWindow={timeWindow} />}
          {tab === 'top-procedures' && <TopProceduresTab instanceId={instanceId} range={range} timeWindow={timeWindow} />}
        </div>
      </div>
    </CollapsibleSection>
  );
}
