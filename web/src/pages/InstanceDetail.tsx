import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CpuChart } from '@/components/CpuChart';
import { MemoryChart } from '@/components/MemoryChart';
import { WaitsChart } from '@/components/WaitsChart';
import { SessionsTable } from '@/components/SessionsTable';
import { DeadlocksTable } from '@/components/DeadlocksTable';
import { BlockingTree } from '@/components/BlockingTree';
import { FileIoChart } from '@/components/FileIoChart';
import { DiskChart } from '@/components/DiskChart';
import { KpiRow } from '@/components/KpiRow';
import { TopWaitsTable } from '@/components/TopWaitsTable';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { authFetch } from '@/lib/auth';

type PresetRange = '1h' | '6h' | '24h' | '7d' | '30d' | '1y';
type TimeRange = PresetRange;

interface CustomRange {
  from: string;
  to: string;
}

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

interface DiskRow {
  volume_mount_point: string;
  logical_volume_name: string;
  total_mb: number;
  available_mb: number;
  used_mb: number;
  used_pct: number;
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

export function InstanceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialAt = searchParams.get('at');
  const initialRange = (searchParams.get('range') as TimeRange) || '1h';
  const [range, setRange] = useState<TimeRange>(initialRange);
  const [customRange, setCustomRange] = useState<CustomRange | null>(null);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [sessionAt, setSessionAt] = useState<string | null>(initialAt);

  // Build query suffix: either ?range=X or ?from=X&to=Y
  const rangeParams = customRange
    ? `from=${encodeURIComponent(new Date(customRange.from).toISOString())}&to=${encodeURIComponent(new Date(customRange.to).toISOString())}`
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

  const { data: cpuData = [] } = useQuery({
    queryKey: ['metrics-cpu', id, range, customRange],
    queryFn: () => fetchJson<Array<Record<string, unknown>>>(`/api/metrics/${id}/cpu?${rangeParams}`),
    refetchInterval: customRange ? false : 15000,
  });

  const { data: memoryData = [] } = useQuery({
    queryKey: ['metrics-memory', id, range, customRange],
    queryFn: () => fetchJson<Array<Record<string, unknown>>>(`/api/metrics/${id}/memory?${rangeParams}`),
    refetchInterval: customRange ? false : 15000,
  });

  const { data: waitsData = [] } = useQuery({
    queryKey: ['metrics-waits', id, range, customRange],
    queryFn: () => fetchJson<Array<Record<string, unknown>>>(`/api/metrics/${id}/waits?${rangeParams}`),
    refetchInterval: customRange ? false : 30000,
  });

  const sessionsUrl = sessionAt
    ? `/api/metrics/${id}/sessions?at=${encodeURIComponent(sessionAt)}`
    : `/api/metrics/${id}/sessions`;

  const { data: sessionsData = [] } = useQuery({
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

  const { data: diskData = [] } = useQuery<DiskRow[]>({
    queryKey: ['metrics-disk', id],
    queryFn: () => fetchJson<DiskRow[]>(`/api/metrics/${id}/disk`),
    refetchInterval: 60000,
  });

  const { data: fileIoData = [] } = useQuery<FileIoRow[]>({
    queryKey: ['metrics-file-io', id, range],
    queryFn: () => fetchJson<FileIoRow[]>(`/api/metrics/${id}/file-io?${rangeParams}`),
    refetchInterval: 30000,
  });

  const ranges: TimeRange[] = ['1h', '6h', '24h', '7d', '30d', '1y'];
  const instance = health?.instance;

  return (
    <div>
      {/* Header */}
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
            <button
              onClick={() => navigate(`/instances/${id}/queries`)}
              className="rounded bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Query Explorer
            </button>
          </div>
          {health && (
            <div className="mt-1 flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              {health.version && <span>{health.version}</span>}
              {health.edition && <span className="text-gray-300 dark:text-gray-600">|</span>}
              {health.edition && <span>{health.edition}</span>}
              {health.uptime_seconds != null && <span className="text-gray-300 dark:text-gray-600">|</span>}
              {health.uptime_seconds != null && (
                <span>Up {formatUptime(health.uptime_seconds)}</span>
              )}
              {health.cpu_count != null && <span className="text-gray-300 dark:text-gray-600">|</span>}
              {health.cpu_count != null && <span>{health.cpu_count} CPUs</span>}
              {health.physical_memory_mb != null && <span className="text-gray-300 dark:text-gray-600">|</span>}
              {health.physical_memory_mb != null && (
                <span>{(health.physical_memory_mb / 1024).toFixed(0)} GB RAM</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* KPI Row */}
      <div className="mt-4">
        <KpiRow
          cpuData={cpuData as Array<{ sql_cpu_pct: number }>}
          waitsData={waitsData as Array<{ wait_type: string; wait_ms_per_sec: number }>}
          sessionsData={sessionsData as Array<{ blocking_session_id: number | null; request_status: string }>}
          fileIoData={fileIoData as Array<{ avg_read_latency_ms: number; avg_write_latency_ms: number }>}
        />
      </div>

      {/* Time range picker */}
      <div className="mt-4 flex items-center gap-1 flex-wrap">
        {ranges.map((r) => (
          <button
            key={r}
            onClick={() => { setRange(r); setCustomRange(null); setShowCustomPicker(false); }}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              range === r && !customRange
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            {r}
          </button>
        ))}
        <button
          onClick={() => setShowCustomPicker((v) => !v)}
          className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
            customRange
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
          }`}
        >
          Custom
        </button>
        {showCustomPicker && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="datetime-local"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            <span className="text-xs text-gray-500">to</span>
            <input
              type="datetime-local"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            <button
              onClick={() => {
                if (customFrom && customTo) {
                  setCustomRange({ from: customFrom, to: customTo });
                }
              }}
              disabled={!customFrom || !customTo}
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        )}
      </div>

      {/* Top Waits */}
      <div className="mt-4">
        <TopWaitsTable data={waitsData as Array<{ wait_type: string; wait_ms_per_sec: number; wait_time_ms: number }>} />
      </div>

      {/* Charts: CPU | Memory | Disk compact card */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CpuChart data={cpuData as never[]} />
        <MemoryChart data={memoryData as never[]} />
        {/* Compact disk card */}
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Disk Space</h3>
          {diskData.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No disk data</p>
          ) : (
            <div className="space-y-2">
              {diskData.map((d) => (
                <div key={d.volume_mount_point}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-gray-700 dark:text-gray-300 truncate" title={`${d.volume_mount_point} ${d.logical_volume_name || ''}`}>
                      {d.volume_mount_point}
                    </span>
                    <span className="ml-2 text-gray-500 dark:text-gray-400">
                      {(d.available_mb / 1024).toFixed(0)}/{(d.total_mb / 1024).toFixed(0)} GB
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          Number(d.used_pct) > 95 ? 'bg-red-500' : Number(d.used_pct) > 90 ? 'bg-yellow-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(100, Number(d.used_pct))}%` }}
                      />
                    </div>
                    <span className={`text-xs font-medium w-10 text-right ${Number(d.used_pct) > 95 ? 'text-red-600 dark:text-red-400' : Number(d.used_pct) > 90 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-600 dark:text-gray-400'}`}>
                      {Number(d.used_pct).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Blocking chains (only shows when there are active blocking chains) */}
      <div className="mt-4">
        <BlockingTree instanceId={id!} />
      </div>

      {/* Collapsible: Waits History */}
      <div className="mt-4">
        <CollapsibleSection title="Wait Stats History">
          <WaitsChart instanceId={id!} range={range} />
        </CollapsibleSection>
      </div>

      {/* Collapsible: Sessions */}
      <div className="mt-4">
        <CollapsibleSection title="Active Sessions" badge={sessionsData.length || undefined}>
          {sessionTimestamps.length > 1 && (
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
          <SessionsTable data={sessionsData as never[]} />
        </CollapsibleSection>
      </div>

      {/* Collapsible: Disk Growth Trend */}
      <div className="mt-4">
        <CollapsibleSection title="Disk Growth Trend">
          <DiskChart instanceId={id!} range={range} />
        </CollapsibleSection>
      </div>

      {/* Collapsible: File I/O */}
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

      {/* Collapsible: Deadlocks */}
      <div className="mt-4">
        <CollapsibleSection title="Deadlocks">
          <DeadlocksTable instanceId={id!} range={range} />
        </CollapsibleSection>
      </div>
    </div>
  );
}
