import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';

interface BreakdownData {
  sql_committed_mb: number;
  sql_target_mb: number;
  buffer_pool_mb: number;
  plan_cache_mb: number;
}

function ProgressBar({ label, valueMb, maxMb }: { label: string; valueMb: number; maxMb: number }) {
  const pct = maxMb > 0 ? Math.min(100, (valueMb / maxMb) * 100) : 0;
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-600 dark:text-gray-400">{label}</span>
        <span className="font-mono text-gray-900 dark:text-gray-100">
          {valueMb >= 1024 ? `${(valueMb / 1024).toFixed(1)} GB` : `${valueMb} MB`}
        </span>
      </div>
      <div className="mt-0.5 h-2 rounded-full bg-gray-100 dark:bg-gray-800">
        <div
          className="h-2 rounded-full bg-blue-500 transition-all"
          style={{ width: `${Math.max(1, pct)}%` }}
        />
      </div>
    </div>
  );
}

export function MemoryBreakdown({ instanceId }: { instanceId: string }) {
  const { data, isLoading } = useQuery<BreakdownData | null>({
    queryKey: ['memory-breakdown', instanceId],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/memory/breakdown`);
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">SQL Memory Breakdown</h3>
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
          Loading...
        </div>
      ) : !data ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Waiting for memory data...</p>
      ) : (
        <>
          <ProgressBar label="Target" valueMb={data.sql_target_mb} maxMb={data.sql_target_mb} />
          <ProgressBar label="Committed" valueMb={data.sql_committed_mb} maxMb={data.sql_target_mb} />
          <ProgressBar label="Buffer Pool" valueMb={data.buffer_pool_mb} maxMb={data.sql_target_mb} />
          <ProgressBar label="Plan Cache" valueMb={data.plan_cache_mb} maxMb={data.sql_target_mb} />
        </>
      )}
    </div>
  );
}
