import { Fragment, useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';

interface SessionRow {
  session_id: number;
  request_id: number | null;
  blocking_session_id: number | null;
  session_status: string;
  request_status: string | null;
  login_name: string;
  host_name: string;
  program_name: string;
  database_name: string;
  command: string | null;
  wait_type: string | null;
  wait_time_ms: number | null;
  wait_resource: string | null;
  elapsed_time_ms: number | null;
  cpu_time_ms: number | null;
  logical_reads: number | null;
  writes: number | null;
  open_transaction_count: number | null;
  granted_memory_kb: number | null;
  current_statement: string | null;
}

interface CurrentActivityProps {
  instanceId: string;
}

type StatusFilter = 'all' | 'running' | 'suspended' | 'sleeping' | 'blocked';
type BlockingFilter = 'all' | 'not_blocked' | 'is_blocked' | 'is_blocker';
type ElapsedFilter = 'all' | '1s' | '5s' | '30s' | '1min' | '5min';

const ELAPSED_THRESHOLDS: Record<Exclude<ElapsedFilter, 'all'>, number> = {
  '1s': 1000,
  '5s': 5000,
  '30s': 30000,
  '1min': 60000,
  '5min': 300000,
};

const WAITFOR_TYPES = ['WAITFOR', 'SP_SERVER_DIAGNOSTICS_SLEEP'];

const MONITOR_APP_NAME = 'Matei Monitor';

function isWaitforSession(s: SessionRow): boolean {
  return s.wait_type != null && WAITFOR_TYPES.includes(s.wait_type);
}

function isMonitoringSession(s: SessionRow): boolean {
  return s.program_name === MONITOR_APP_NAME;
}

function hasActiveRequest(s: SessionRow): boolean {
  return s.request_status != null;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  if (totalSec < 3600) return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
  if (totalSec < 86400) return `${Math.floor(totalSec / 3600)}h ${Math.floor((totalSec % 3600) / 60)}m`;
  return `${Math.floor(totalSec / 86400)}d ${Math.floor((totalSec % 86400) / 3600)}h`;
}

function formatRate(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.round(value)}`;
}

function statusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'running': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300';
    case 'runnable': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300';
    case 'suspended': return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
    case 'sleeping': return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
    default: return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.json();
}

export function CurrentActivity({ instanceId }: CurrentActivityProps) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [blockingFilter, setBlockingFilter] = useState<BlockingFilter>('all');
  const [elapsedFilter, setElapsedFilter] = useState<ElapsedFilter>('all');
  const [loginFilter, setLoginFilter] = useState('all');
  const [dbFilter, setDbFilter] = useState('all');
  const [showSystem, setShowSystem] = useState(false);
  const [showMonitoring, setShowMonitoring] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const { data: sessionsData = [], dataUpdatedAt } = useQuery<SessionRow[]>({
    queryKey: ['current-activity', instanceId],
    queryFn: () => fetchJson<SessionRow[]>(`/api/metrics/${instanceId}/sessions`),
    refetchInterval: autoRefresh ? 15000 : false,
  });

  // Reset expanded rows when data refreshes
  useEffect(() => {
    setExpandedRows(new Set());
  }, [dataUpdatedAt]);

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '\u2014';

  // Compute blocker sets from all data
  const blockerIds = useMemo(() => {
    const ids = new Set<number>();
    for (const s of sessionsData) {
      if (s.blocking_session_id && s.blocking_session_id > 0) {
        ids.add(s.blocking_session_id);
      }
    }
    return ids;
  }, [sessionsData]);

  const blockedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const s of sessionsData) {
      if (s.blocking_session_id && s.blocking_session_id > 0) {
        ids.add(s.session_id);
      }
    }
    return ids;
  }, [sessionsData]);

  // Distinct logins and databases for dropdown options
  const distinctLogins = useMemo(() => {
    const logins = new Set<string>();
    for (const s of sessionsData) if (s.login_name) logins.add(s.login_name);
    return [...logins].sort();
  }, [sessionsData]);

  const distinctDatabases = useMemo(() => {
    const dbs = new Set<string>();
    for (const s of sessionsData) if (s.database_name) dbs.add(s.database_name);
    return [...dbs].sort();
  }, [sessionsData]);

  // Filter sessions
  const filteredSessions = useMemo(() => {
    let result = sessionsData;

    // Hide WAITFOR sessions unless toggled
    if (!showSystem) {
      result = result.filter((s) => !isWaitforSession(s));
    }

    // Hide monitoring sessions unless toggled
    if (!showMonitoring) {
      result = result.filter((s) => !isMonitoringSession(s));
    }

    // Status filter
    if (statusFilter === 'blocked') {
      result = result.filter((s) => blockedIds.has(s.session_id));
    } else if (statusFilter !== 'all') {
      result = result.filter((s) => {
        const status = (s.request_status || s.session_status || '').toLowerCase();
        return status === statusFilter;
      });
    }

    // Blocking filter
    if (blockingFilter === 'not_blocked') {
      result = result.filter((s) => !s.blocking_session_id || s.blocking_session_id <= 0);
    } else if (blockingFilter === 'is_blocked') {
      result = result.filter((s) => blockedIds.has(s.session_id));
    } else if (blockingFilter === 'is_blocker') {
      result = result.filter((s) => blockerIds.has(s.session_id));
    }

    // Elapsed filter
    if (elapsedFilter !== 'all') {
      const threshold = ELAPSED_THRESHOLDS[elapsedFilter];
      result = result.filter((s) => s.elapsed_time_ms != null && s.elapsed_time_ms >= threshold);
    }

    // Login filter
    if (loginFilter !== 'all') {
      result = result.filter((s) => s.login_name === loginFilter);
    }

    // Database filter
    if (dbFilter !== 'all') {
      result = result.filter((s) => s.database_name === dbFilter);
    }

    // Sort by elapsed time DESC
    return [...result].sort((a, b) => (b.elapsed_time_ms ?? 0) - (a.elapsed_time_ms ?? 0));
  }, [sessionsData, showSystem, showMonitoring, statusFilter, blockingFilter, elapsedFilter, loginFilter, dbFilter, blockedIds, blockerIds]);

  // Session count always excludes WAITFOR and monitoring sessions
  const sessionCount = useMemo(() => {
    return sessionsData.filter((s) => !isWaitforSession(s) && !isMonitoringSession(s)).length;
  }, [sessionsData]);

  const clearFilters = useCallback(() => {
    setStatusFilter('all');
    setBlockingFilter('all');
    setElapsedFilter('all');
    setLoginFilter('all');
    setDbFilter('all');
    setShowSystem(false);
    setShowMonitoring(false);
  }, []);

  const hasFilters = statusFilter !== 'all' || blockingFilter !== 'all' || elapsedFilter !== 'all' || loginFilter !== 'all' || dbFilter !== 'all' || showSystem || showMonitoring;

  const toggleRow = useCallback((key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectClass = 'rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

  return (
    <div data-testid="current-activity">
      {/* Header: auto-refresh toggle + last updated + session count */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setAutoRefresh((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            autoRefresh
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
          }`}
          data-testid="auto-refresh-toggle"
        >
          {autoRefresh ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
          )}
          {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 dark:text-gray-400" data-testid="last-updated">
            Last updated: {lastUpdated}
          </span>
          <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300" data-testid="session-count">
            {sessionCount} sessions
          </span>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-2 flex-wrap mb-3" data-testid="filters-row">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className={selectClass}
          data-testid="filter-status"
        >
          <option value="all">All statuses</option>
          <option value="running">Running</option>
          <option value="suspended">Suspended</option>
          <option value="sleeping">Sleeping</option>
          <option value="blocked">Blocked</option>
        </select>

        <select
          value={blockingFilter}
          onChange={(e) => setBlockingFilter(e.target.value as BlockingFilter)}
          className={selectClass}
          data-testid="filter-blocking"
        >
          <option value="all">All blocking</option>
          <option value="not_blocked">Not blocked</option>
          <option value="is_blocked">Is blocked</option>
          <option value="is_blocker">Is blocker</option>
        </select>

        <select
          value={elapsedFilter}
          onChange={(e) => setElapsedFilter(e.target.value as ElapsedFilter)}
          className={selectClass}
          data-testid="filter-elapsed"
        >
          <option value="all">All elapsed</option>
          <option value="1s">&gt;1s</option>
          <option value="5s">&gt;5s</option>
          <option value="30s">&gt;30s</option>
          <option value="1min">&gt;1min</option>
          <option value="5min">&gt;5min</option>
        </select>

        <select
          value={loginFilter}
          onChange={(e) => setLoginFilter(e.target.value)}
          className={selectClass}
          data-testid="filter-login"
        >
          <option value="all">All logins</option>
          {distinctLogins.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>

        <select
          value={dbFilter}
          onChange={(e) => setDbFilter(e.target.value)}
          className={selectClass}
          data-testid="filter-database"
        >
          <option value="all">All databases</option>
          {distinctDatabases.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="rounded px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            data-testid="clear-filters"
          >
            Clear filters
          </button>
        )}

        <div className="ml-auto flex items-center gap-4">
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showMonitoring}
              onChange={(e) => setShowMonitoring(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
              data-testid="show-monitoring-toggle"
            />
            Show monitoring sessions
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showSystem}
              onChange={(e) => setShowSystem(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
              data-testid="show-system-toggle"
            />
            Show system sessions
          </label>
        </div>
      </div>

      {/* Sessions table */}
      <div className="w-full overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full table-fixed text-left text-xs" data-testid="sessions-table">
          <colgroup>
            <col style={{ width: '4%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '26%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '13%' }} />
          </colgroup>
          <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            <tr>
              <th className="px-2 py-2">SPID</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Blocking</th>
              <th className="px-2 py-2 text-right">CPU</th>
              <th className="px-2 py-2">Query</th>
              <th className="px-2 py-2 text-right">Elapsed</th>
              <th className="px-2 py-2">Login</th>
              <th className="px-2 py-2">Program</th>
              <th className="px-2 py-2 text-right">Reads</th>
              <th className="px-2 py-2 text-right">Writes</th>
              <th className="px-2 py-2">Database</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800 dark:text-gray-300">
            {filteredSessions.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No sessions match the current filters
                </td>
              </tr>
            ) : (
              filteredSessions.map((s, i) => {
                const rowKey = `${s.session_id}-${i}`;
                const isExpanded = expandedRows.has(rowKey);
                const isBlocker = blockerIds.has(s.session_id);
                const isBlocked = blockedIds.has(s.session_id);
                const displayStatus = s.request_status || s.session_status || 'unknown';
                const rowBg = isBlocker
                  ? 'bg-red-50 dark:bg-red-950'
                  : isBlocked
                    ? 'bg-orange-50 dark:bg-orange-950'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800';

                return (
                  <Fragment key={rowKey}>
                    <tr
                      className={`cursor-pointer ${rowBg}`}
                      onClick={() => toggleRow(rowKey)}
                      data-testid={`session-row-${s.session_id}`}
                    >
                      <td className="px-2 py-1.5 font-medium whitespace-nowrap">
                        <span className="mr-1 text-gray-400 inline-block w-3">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                        {s.session_id}
                        {isBlocker && <span className="ml-1 text-red-600" title="Head blocker">!</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(displayStatus)}`}>
                          {displayStatus}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        {isBlocked ? (
                          <span className="font-medium text-red-600">{s.blocking_session_id}</span>
                        ) : isBlocker ? (
                          <span className="font-medium text-orange-600">blocker</span>
                        ) : '-'}
                      </td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">{hasActiveRequest(s) ? formatDuration(s.cpu_time_ms) : '-'}</td>
                      <td className="max-w-0 overflow-hidden truncate px-2 py-1.5 font-mono" title={s.current_statement ?? ''}>
                        {s.current_statement || '-'}
                      </td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">{formatDuration(s.elapsed_time_ms)}</td>
                      <td className="overflow-hidden truncate px-2 py-1.5">{s.login_name}</td>
                      <td className="overflow-hidden truncate px-2 py-1.5" title={s.program_name}>{s.program_name || '-'}</td>
                      <td className="px-2 py-1.5 text-right">{hasActiveRequest(s) ? (s.logical_reads?.toLocaleString() ?? '-') : '-'}</td>
                      <td className="px-2 py-1.5 text-right">{hasActiveRequest(s) ? (s.writes?.toLocaleString() ?? '-') : '-'}</td>
                      <td className="overflow-hidden truncate px-2 py-1.5">{s.database_name ?? '-'}</td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={11} className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700" data-testid={`session-detail-${s.session_id}`}>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-4">
                            <div><span className="text-gray-500 dark:text-gray-400">CPU Time:</span> {hasActiveRequest(s) ? formatDuration(s.cpu_time_ms) : '-'}</div>
                            <div><span className="text-gray-500 dark:text-gray-400">Avg CPU/s:</span> {hasActiveRequest(s) && s.cpu_time_ms != null && s.elapsed_time_ms != null && s.elapsed_time_ms > 0 ? `${Math.round(s.cpu_time_ms / s.elapsed_time_ms * 100)}%` : '-'}</div>
                            <div><span className="text-gray-500 dark:text-gray-400">Avg Reads/s:</span> {hasActiveRequest(s) && s.logical_reads != null && s.elapsed_time_ms != null && s.elapsed_time_ms > 0 ? `${formatRate(s.logical_reads / (s.elapsed_time_ms / 1000))} reads/s` : '-'}</div>
                            <div><span className="text-gray-500 dark:text-gray-400">Memory Grant:</span> {s.granted_memory_kb != null ? `${(s.granted_memory_kb / 1024).toFixed(1)} MB` : '-'}</div>
                            <div><span className="text-gray-500 dark:text-gray-400">Wait Type:</span> <span className="font-mono">{s.wait_type ?? '-'}</span></div>
                            <div><span className="text-gray-500 dark:text-gray-400">Wait Resource:</span> <span className="font-mono">{s.wait_resource ?? '-'}</span></div>
                            <div><span className="text-gray-500 dark:text-gray-400">Wait Time:</span> {formatDuration(s.wait_time_ms)}</div>
                            <div><span className="text-gray-500 dark:text-gray-400">Open Transactions:</span> {s.open_transaction_count ?? '-'}</div>
                            <div><span className="text-gray-500 dark:text-gray-400">Host:</span> {s.host_name ?? '-'}</div>
                            <div><span className="text-gray-500 dark:text-gray-400">Command:</span> {s.command ?? '-'}</div>
                            <div><span className="text-gray-500 dark:text-gray-400">Logical Reads:</span> {hasActiveRequest(s) ? (s.logical_reads?.toLocaleString() ?? '-') : '-'}</div>
                            <div><span className="text-gray-500 dark:text-gray-400">Writes:</span> {hasActiveRequest(s) ? (s.writes?.toLocaleString() ?? '-') : '-'}</div>
                          </div>
                          {s.current_statement && (
                            <div className="mt-2">
                              <span className="text-xs text-gray-500 dark:text-gray-400">Full Query:</span>
                              <pre className="mt-1 max-h-48 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all rounded bg-gray-900 p-2 text-xs text-gray-100 dark:bg-gray-950">{s.current_statement}</pre>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
