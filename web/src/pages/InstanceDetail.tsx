import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CpuChart } from '@/components/CpuChart';
import { WaitsChart } from '@/components/WaitsChart';
import { SessionsTable } from '@/components/SessionsTable';
import { DeadlocksTable } from '@/components/DeadlocksTable';
import { BlockingTree } from '@/components/BlockingTree';
import { FileIoChart } from '@/components/FileIoChart';
import { DiskChart } from '@/components/DiskChart';
import { StatusBar } from '@/components/StatusBar';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { CurrentActivity } from '@/components/CurrentActivity';
import { OverviewTimeline, type TimeWindow } from '@/components/OverviewTimeline';
import { OverviewMetricCharts } from '@/components/OverviewMetricCharts';
import { AnalysisSection } from '@/components/AnalysisSection';
import { SqlServerMetrics } from '@/components/SqlServerMetrics';
import { PermissionsTable } from '@/components/PermissionsTable';
import { authFetch } from '@/lib/auth';

type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d' | '1y';

interface HealthData {
  instance_name: string;
  edition: string;
  version: string;
  sp_level: string;
  uptime_seconds: number;
  cpu_count: number;
  physical_memory_mb: number;
  committed_mb: number;
  target_mb: number;
  hadr_enabled: boolean;
  is_clustered: boolean;
  sqlserver_start_time: string;
  collected_at: string;
  instance: { name: string; host: string; port: number; status: string; last_seen: string | null } | null;
}

interface HostInfo {
  host_platform: string;
  host_distribution: string;
  host_release: string;
  host_service_pack_level: string;
}

interface FileIoRow {
  database_name: string;
  file_name: string;
  file_type: string;
  total_reads: number;
  total_writes: number;
  avg_read_latency_ms: number;
  avg_write_latency_ms: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.json();
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

type Tab = 'history' | 'current';

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
        active
          ? 'border-blue-500 text-blue-600 dark:text-blue-400'
          : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

export function InstanceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialAt = searchParams.get('at');
  const initialTab = (searchParams.get('tab') as Tab) || 'history';
  const initialRange = (searchParams.get('range') as TimeRange) || '1h';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [range] = useState<TimeRange>(initialRange);
  const [sessionAt, setSessionAt] = useState<string | null>(initialAt);
  const [timeWindow, setTimeWindow] = useState<TimeWindow | null>(() => {
    const now = new Date();
    return {
      from: new Date(now.getTime() - 60 * 60_000).toISOString(),
      to: now.toISOString(),
    };
  });

  const switchTab = useCallback((newTab: Tab) => {
    setTab(newTab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newTab === 'history') next.delete('tab');
      else next.set('tab', newTab);
      return next;
    });
  }, [setSearchParams]);

  // Build query suffix: window from overview timeline, or fallback to range preset
  const rangeParams = timeWindow
    ? `from=${encodeURIComponent(timeWindow.from)}&to=${encodeURIComponent(timeWindow.to)}`
    : `range=${range}`;

  // When navigated via alert deep-link, set sessionAt from URL
  useEffect(() => {
    if (initialAt) setSessionAt(initialAt);
  }, [initialAt]);

  const { data: health } = useQuery({
    queryKey: ['metrics-health', id],
    queryFn: () => fetchJson<HealthData>(`/api/metrics/${id}/health`),
    refetchInterval: 60000,
  });

  const { data: hostInfo } = useQuery({
    queryKey: ['host-info', id],
    queryFn: () => fetchJson<HostInfo | null>(`/api/metrics/${id}/host-info`),
    refetchInterval: 300000,
  });

  const hasFixedWindow = !!timeWindow;

  const { data: cpuData = [] } = useQuery({
    queryKey: ['metrics-cpu', id, range, timeWindow],
    queryFn: () => fetchJson<Array<Record<string, unknown>>>(`/api/metrics/${id}/cpu?${rangeParams}`),
    refetchInterval: hasFixedWindow ? false : 15000,
  });

  const sessionsUrl = sessionAt
    ? `/api/metrics/${id}/sessions?at=${encodeURIComponent(sessionAt)}`
    : `/api/metrics/${id}/sessions`;

  const { data: sessionsData = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['metrics-sessions', id, sessionAt],
    queryFn: () => fetchJson<Array<Record<string, unknown>>>(sessionsUrl),
    refetchInterval: sessionAt ? false : 15000,
  });

  // Session history timestamps for the scrubber
  const sessionHistoryRange: TimeRange = (['1h', '6h', '24h'].includes(range) ? range : '1h') as TimeRange;
  const { data: sessionTimestamps = [] } = useQuery<string[]>({
    queryKey: ['session-history', id, sessionHistoryRange],
    queryFn: () => fetchJson<string[]>(`/api/metrics/${id}/sessions/history?range=${sessionHistoryRange}`),
    refetchInterval: 30000,
  });

  const { data: fileIoData = [] } = useQuery<FileIoRow[]>({
    queryKey: ['metrics-file-io', id, range, timeWindow],
    queryFn: () => fetchJson<FileIoRow[]>(`/api/metrics/${id}/file-io?${rangeParams}`),
    refetchInterval: hasFixedWindow ? false : 30000,
  });

  const instance = health?.instance;

  return (
    <div>
      {/* Header: Instance name + status + Query Explorer + inline stats */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/dashboard')}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          title="Back to Dashboard"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {instance ? instance.name : `Instance ${id}`}
            </h2>
            {instance && (
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${instance.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} title={instance.status} />
            )}
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <button
              onClick={() => navigate(`/instances/${id}/queries`)}
              className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
              data-testid="query-explorer-header"
            >
              Query Explorer &rarr;
            </button>
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 flex-wrap">
            {health?.version && <span>{health.version}</span>}
            {health?.edition && <><span className="text-gray-300 dark:text-gray-600">|</span><span>{health.edition}</span></>}
            {health?.uptime_seconds != null && <><span className="text-gray-300 dark:text-gray-600">|</span><span>Up {formatUptime(health.uptime_seconds)}</span></>}
            {health?.cpu_count != null && <><span className="text-gray-300 dark:text-gray-600">|</span><span>{health.cpu_count} CPUs</span></>}
            {health?.physical_memory_mb != null && <><span className="text-gray-300 dark:text-gray-600">|</span><span>{(health.physical_memory_mb / 1024).toFixed(0)} GB RAM</span></>}
          </div>
        </div>
      </div>

      {/* Sticky StatusBar */}
      <div className="sticky top-0 z-10 bg-gray-950 border-b border-gray-800 -mx-6 px-6 py-2" data-testid="sticky-statusbar">
        <StatusBar instanceId={id!} />
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-700 mt-2" data-testid="tab-bar">
        <TabButton active={tab === 'history'} onClick={() => switchTab('history')}>History</TabButton>
        <TabButton active={tab === 'current'} onClick={() => switchTab('current')}>Current Activity</TabButton>
      </div>

      {/* Current Activity tab */}
      {tab === 'current' && (
        <div className="mt-4">
          <CurrentActivity instanceId={id!} />
        </div>
      )}

      {/* History tab */}
      {tab === 'history' && <>
      {/* Overview Timeline with drag selection */}
      <div className="mt-4">
        <OverviewTimeline
          instanceId={id!}
          window={timeWindow}
          onWindowChange={setTimeWindow}
        />
      </div>

      {/* 2. Metric detail charts (2x2 grid) */}
      <div className="mt-4">
        <OverviewMetricCharts instanceId={id!} window={timeWindow} />
      </div>


      {/* Analysis section (Top Queries / Tracked Queries / Top Procedures) */}
      <div className="mt-4">
        <AnalysisSection instanceId={id!} range={range} timeWindow={timeWindow} />
      </div>

      {/* SQL Server Metrics (perf counters + server config) */}
      {timeWindow && (
        <div className="mt-6">
        <SqlServerMetrics
          instanceId={id!}
          range={{ from: timeWindow.from, to: timeWindow.to }}
          health={health ? { version: health.version, edition: health.edition } : undefined}
        />
        </div>
      )}

      {/* Permissions */}
      <div className="mt-6">
        <PermissionsTable instanceId={id!} />
      </div>

      {/* 5. Active Sessions (full width) */}
      <div className="mt-4">
        <CollapsibleSection title="Active Sessions" badge={sessionsData.length} defaultOpen>
          {sessionTimestamps.length >= 1 && (
            <div className="mb-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Snapshot:</span>
                <button
                  onClick={() => setSessionAt(null)}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                    !sessionAt
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  Latest
                </button>
                {sessionTimestamps.slice(0, 20).map((ts) => {
                  const d = new Date(ts);
                  const label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  const isSelected = sessionAt === ts;
                  return (
                    <button
                      key={ts}
                      onClick={() => setSessionAt(ts)}
                      className={`rounded px-2 py-0.5 text-xs font-mono transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {sessionAt && (
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Showing snapshot: {new Date(sessionAt).toLocaleString()}
                </div>
              )}
            </div>
          )}
          {sessionsLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-500 dark:text-gray-400">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
              Loading sessions...
            </div>
          ) : (
            <SessionsTable data={sessionsData as never[]} compact />
          )}
        </CollapsibleSection>
      </div>

      {/* Disk Growth Trend (collapsible) */}
      <div className="mt-4">
        <CollapsibleSection title="Disk Growth Trend">
          <DiskChart instanceId={id!} range={range} />
        </CollapsibleSection>
      </div>

      {/* 7. Blocking chains (only visible when data, collapsible) */}
      <div className="mt-4">
        <BlockingTree instanceId={id!} />
      </div>

      {/* 8. Deadlocks (collapsible) */}
      <div className="mt-4">
        <CollapsibleSection title="Deadlocks" badge={0}>
          <DeadlocksTable instanceId={id!} range={range} />
        </CollapsibleSection>
      </div>

      {/* 9. File I/O chart + table (collapsible) */}
      <div className="mt-4">
        <CollapsibleSection title="File I/O">
          <FileIoChart instanceId={id!} range={range} />
          {fileIoData.length > 0 && (
            <div className="mt-3">
              <table className="w-full text-left text-sm">
                <thead className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="py-1 pr-3">File</th>
                    <th className="py-1 pr-3 text-right">Avg Read ms</th>
                    <th className="py-1 text-right">Avg Write ms</th>
                  </tr>
                </thead>
                <tbody>
                  {[...fileIoData]
                    .sort((a, b) => (b.avg_read_latency_ms + b.avg_write_latency_ms) / 2 - (a.avg_read_latency_ms + a.avg_write_latency_ms) / 2)
                    .slice(0, 10)
                    .map((f) => {
                      const basename = f.file_name.split(/[/\\]/).pop() || f.file_name;
                      return (
                        <tr key={`${f.database_name}-${f.file_name}`}>
                          <td className="py-1 pr-3 font-mono text-xs text-gray-900 dark:text-gray-100" title={`${f.database_name}/${f.file_name}`}>
                            {basename}
                          </td>
                          <td className={`py-1 pr-3 text-right font-medium ${f.avg_read_latency_ms > 50 ? 'text-red-600 dark:text-red-400' : f.avg_read_latency_ms > 20 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-700 dark:text-gray-300'}`}>
                            {f.avg_read_latency_ms.toFixed(1)}
                          </td>
                          <td className={`py-1 text-right font-medium ${f.avg_write_latency_ms > 50 ? 'text-red-600 dark:text-red-400' : f.avg_write_latency_ms > 20 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-700 dark:text-gray-300'}`}>
                            {f.avg_write_latency_ms.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleSection>
      </div>

      </>}
    </div>
  );
}
