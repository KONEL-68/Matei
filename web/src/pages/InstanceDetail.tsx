import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CpuChart } from '@/components/CpuChart';
import { MemoryChart } from '@/components/MemoryChart';
import { WaitsTable } from '@/components/WaitsTable';
import { SessionsTable } from '@/components/SessionsTable';
import { authFetch } from '@/lib/auth';

type TimeRange = '1h' | '6h' | '24h' | '7d';

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

  const ranges: TimeRange[] = ['1h', '6h', '24h', '7d'];
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

      {/* Waits */}
      <div className="mt-4">
        <WaitsTable data={waitsData as never[]} />
      </div>

      {/* Sessions */}
      <div className="mt-4">
        <SessionsTable data={sessionsData as never[]} />
      </div>
    </div>
  );
}
