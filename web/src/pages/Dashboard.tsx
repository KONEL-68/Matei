import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '@/lib/auth';

interface OverviewInstance {
  id: number;
  name: string;
  host: string;
  port: number;
  status: string;
  last_seen: string | null;
  cpu: { sql_cpu_pct: number; other_process_cpu_pct: number; system_idle_pct: number } | null;
  memory: { os_total_memory_mb: number; os_available_memory_mb: number; sql_committed_mb: number; sql_target_mb: number } | null;
  health: { version: string; edition: string; uptime_seconds: number } | null;
  top_waits: Array<{ wait_type: string; wait_ms_per_sec: number }>;
}

interface OverviewData {
  total: number;
  online: number;
  offline: number;
  error: number;
  instances: OverviewInstance[];
}

async function fetchOverview(): Promise<OverviewData> {
  const res = await authFetch('/api/metrics/overview');
  if (!res.ok) throw new Error('Failed to fetch overview');
  return res.json();
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
    green: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800',
    gray: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
    red: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
  };
  const dotColors: Record<string, string> = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    gray: 'bg-gray-400',
    red: 'bg-red-500',
  };
  return (
    <div className={`rounded-lg border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${dotColors[color]}`} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  );
}

function statusDot(status: string) {
  const colors: Record<string, string> = {
    online: 'bg-green-500',
    unreachable: 'bg-red-500',
    unknown: 'bg-gray-400',
  };
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${colors[status] ?? colors.unknown}`} />;
}

export function Dashboard() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useQuery<OverviewData>({
    queryKey: ['metrics-overview'],
    queryFn: fetchOverview,
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h2>
        <div className="mt-6 text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h2>
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-8 text-center dark:border-red-800 dark:bg-red-950">
          <p className="text-red-700 dark:text-red-400">Failed to load dashboard data.</p>
          <p className="text-sm text-red-500 dark:text-red-500 mt-1">The API may be unavailable. Check that the backend is running.</p>
        </div>
      </div>
    );
  }

  if (data.total === 0) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h2>
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
          <p className="text-gray-500 dark:text-gray-400">No instances configured.</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            Add a SQL Server instance to start monitoring.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h2>

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-4 gap-4">
        <StatCard label="Total" value={data.total} color="blue" />
        <StatCard label="Online" value={data.online} color="green" />
        <StatCard label="Offline" value={data.offline} color="gray" />
        <StatCard label="Error" value={data.error} color="red" />
      </div>

      {/* Instance grid */}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.instances.map((inst) => (
          <div
            key={inst.id}
            onClick={() => navigate(`/instances/${inst.id}`)}
            className="cursor-pointer rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {statusDot(inst.status)}
                <span className="font-semibold text-gray-900 dark:text-gray-100">{inst.name}</span>
              </div>
              {inst.health && (
                <span className="text-xs text-gray-500 dark:text-gray-400">{inst.health.version}</span>
              )}
            </div>

            {/* CPU */}
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>SQL CPU</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {inst.cpu ? `${inst.cpu.sql_cpu_pct}%` : '-'}
                </span>
              </div>
              <div className="mt-1 h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800">
                <div
                  className="h-2 rounded-full bg-blue-500 transition-all"
                  style={{ width: `${inst.cpu?.sql_cpu_pct ?? 0}%` }}
                />
              </div>
            </div>

            {/* Memory */}
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>Memory</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {inst.memory
                    ? `${inst.memory.sql_committed_mb} / ${inst.memory.sql_target_mb} MB`
                    : '-'}
                </span>
              </div>
              <div className="mt-1 h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800">
                <div
                  className="h-2 rounded-full bg-purple-500 transition-all"
                  style={{
                    width: inst.memory && inst.memory.sql_target_mb > 0
                      ? `${Math.min(100, (inst.memory.sql_committed_mb / inst.memory.sql_target_mb) * 100)}%`
                      : '0%',
                  }}
                />
              </div>
            </div>

            {/* Top waits */}
            {inst.top_waits.length > 0 && (
              <div className="mt-3 border-t border-gray-100 pt-2 dark:border-gray-800">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Top Waits</span>
                <div className="mt-1 space-y-0.5">
                  {inst.top_waits.map((w) => (
                    <div key={w.wait_type} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-gray-600 dark:text-gray-400 truncate max-w-[160px]">{w.wait_type}</span>
                      <span className="text-gray-500 dark:text-gray-400">{w.wait_ms_per_sec.toFixed(1)} ms/sec</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
