import { useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CpuChart } from '@/components/CpuChart';
import { WaitsChart } from '@/components/WaitsChart';
import { DiskChart } from '@/components/DiskChart';
import { StatusBar } from '@/components/StatusBar';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { CurrentActivity } from '@/components/CurrentActivity';
import { OverviewTimeline, type TimeWindow } from '@/components/OverviewTimeline';
import { OverviewMetricCharts } from '@/components/OverviewMetricCharts';
import { AnalysisSection } from '@/components/AnalysisSection';
import { SqlServerMetrics } from '@/components/SqlServerMetrics';
import { PermissionsTable } from '@/components/PermissionsTable';
import { DiskUsage } from '@/components/DiskUsage';
import { BlockingHistory } from '@/components/BlockingHistory';
import { DatabasesList } from '@/components/DatabasesList';
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
  const initialTab = (searchParams.get('tab') as Tab) || 'history';
  const initialRange = (searchParams.get('range') as TimeRange) || '1h';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [range] = useState<TimeRange>(initialRange);
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

      {/* Wait Stats full-width chart */}
      <div className="mt-4">
        <WaitsChart
          instanceId={id!}
          range={range}
          from={timeWindow?.from}
          to={timeWindow?.to}
        />
      </div>

      {/* Blocking History */}
      <div className="mt-4">
        <CollapsibleSection title="Blocking" defaultOpen>
          <BlockingHistory instanceId={id!} range={range} timeWindow={timeWindow} />
        </CollapsibleSection>
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

      {/* Disks: usage table + growth trend chart */}
      <div className="mt-4">
        <CollapsibleSection title="Disks" defaultOpen>
          <DiskUsage instanceId={id!} timeWindow={timeWindow} />
          <div className="mt-4">
            <DiskChart instanceId={id!} range={range} />
          </div>
        </CollapsibleSection>
      </div>

      {/* Databases */}
      <div className="mt-4">
        <CollapsibleSection title="Databases" defaultOpen>
          <DatabasesList instanceId={id!} timeWindow={timeWindow} />
        </CollapsibleSection>
      </div>

      </>}
    </div>
  );
}
