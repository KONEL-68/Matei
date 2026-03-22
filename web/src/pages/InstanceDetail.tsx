import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CpuChart } from '@/components/CpuChart';
import { MemoryChart } from '@/components/MemoryChart';
import { WaitsTable } from '@/components/WaitsTable';
import { SessionsTable } from '@/components/SessionsTable';
import { DeadlocksTable } from '@/components/DeadlocksTable';
import { BlockingTree } from '@/components/BlockingTree';
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
  const [range, setRange] = useState<TimeRange>('1h');

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
    queryKey: ['metrics-cpu', id, range],
    queryFn: () => fetchJson<Array<Record<string, unknown>>>(`/api/metrics/${id}/cpu?range=${range}`),
    refetchInterval: 15000,
  });

  const { data: memoryData = [] } = useQuery({
    queryKey: ['metrics-memory', id, range],
    queryFn: () => fetchJson<Array<Record<string, unknown>>>(`/api/metrics/${id}/memory?range=${range}`),
    refetchInterval: 15000,
  });

  const { data: waitsData = [] } = useQuery({
    queryKey: ['metrics-waits', id, range],
    queryFn: () => fetchJson<Array<Record<string, unknown>>>(`/api/metrics/${id}/waits?range=${range}`),
    refetchInterval: 30000,
  });

  const { data: sessionsData = [] } = useQuery({
    queryKey: ['metrics-sessions', id],
    queryFn: () => fetchJson<Array<Record<string, unknown>>>(`/api/metrics/${id}/sessions`),
    refetchInterval: 15000,
  });

  const { data: diskData = [] } = useQuery<DiskRow[]>({
    queryKey: ['metrics-disk', id],
    queryFn: () => fetchJson<DiskRow[]>(`/api/metrics/${id}/disk`),
    refetchInterval: 60000,
  });

  const { data: fileIoData = [] } = useQuery<FileIoRow[]>({
    queryKey: ['metrics-file-io', id, range],
    queryFn: () => fetchJson<FileIoRow[]>(`/api/metrics/${id}/file-io?range=${range}`),
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

      {/* Host info card */}
      {hostInfo && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">OS: </span>
              <span className="text-gray-900 dark:text-gray-100">{hostInfo.host_distribution || hostInfo.host_platform}</span>
            </div>
            {hostInfo.host_release && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">Release: </span>
                <span className="text-gray-900 dark:text-gray-100">{hostInfo.host_release}</span>
              </div>
            )}
            {hostInfo.host_service_pack_level && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">SP: </span>
                <span className="text-gray-900 dark:text-gray-100">{hostInfo.host_service_pack_level}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Time range picker */}
      <div className="mt-4 flex gap-1">
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

      {/* Charts */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CpuChart data={cpuData as never[]} />
        <MemoryChart data={memoryData as never[]} />
      </div>

      {/* Blocking chains (only shows when there are active blocking chains) */}
      <div className="mt-4">
        <BlockingTree instanceId={id!} />
      </div>

      {/* Waits */}
      <div className="mt-4">
        <WaitsTable data={waitsData as never[]} />
      </div>

      {/* Sessions */}
      <div className="mt-4">
        <SessionsTable data={sessionsData as never[]} />
      </div>

      {/* Disk space */}
      {diskData.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Disk Space</h3>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2">Volume</th>
                <th className="px-3 py-2 text-right">Total GB</th>
                <th className="px-3 py-2 text-right">Free GB</th>
                <th className="px-3 py-2 text-right">Used %</th>
                <th className="px-3 py-2 w-40">Usage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {diskData.map((d) => (
                <tr key={d.volume_mount_point} className="dark:text-gray-300">
                  <td className="px-3 py-2 font-mono text-xs">{d.volume_mount_point} {d.logical_volume_name ? `(${d.logical_volume_name})` : ''}</td>
                  <td className="px-3 py-2 text-right">{(d.total_mb / 1024).toFixed(1)}</td>
                  <td className="px-3 py-2 text-right">{(d.available_mb / 1024).toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-medium">{Number(d.used_pct).toFixed(1)}%</td>
                  <td className="px-3 py-2">
                    <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          Number(d.used_pct) > 95 ? 'bg-red-500' : Number(d.used_pct) > 90 ? 'bg-yellow-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(100, Number(d.used_pct))}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* File I/O */}
      {fileIoData.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">File I/O (top by latency)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Reads</th>
                  <th className="px-3 py-2 text-right">Writes</th>
                  <th className="px-3 py-2 text-right">Avg Read ms</th>
                  <th className="px-3 py-2 text-right">Avg Write ms</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {fileIoData.map((f) => (
                  <tr key={`${f.database_name}-${f.file_name}`} className="dark:text-gray-300">
                    <td className="px-3 py-2">
                      <span className="text-gray-500 dark:text-gray-400 text-xs">{f.database_name}/</span>
                      <span className="font-mono text-xs">{f.file_name}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">{f.file_type}</td>
                    <td className="px-3 py-2 text-right">{f.total_reads.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{f.total_writes.toLocaleString()}</td>
                    <td className={`px-3 py-2 text-right font-medium ${f.avg_read_latency_ms > 50 ? 'text-red-600 dark:text-red-400' : f.avg_read_latency_ms > 20 ? 'text-yellow-600 dark:text-yellow-400' : ''}`}>
                      {f.avg_read_latency_ms.toFixed(1)}
                    </td>
                    <td className={`px-3 py-2 text-right font-medium ${f.avg_write_latency_ms > 50 ? 'text-red-600 dark:text-red-400' : f.avg_write_latency_ms > 20 ? 'text-yellow-600 dark:text-yellow-400' : ''}`}>
                      {f.avg_write_latency_ms.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Deadlocks */}
      <div className="mt-4">
        <DeadlocksTable instanceId={id!} range={range} />
      </div>
    </div>
  );
}
