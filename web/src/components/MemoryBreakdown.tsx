import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';

interface BreakdownData {
  total_mb: number;
  target_mb: number;
  stolen_mb: number;
  database_cache_mb: number;
  deficit_mb: number;
}

function formatMb(mb: number): string {
  if (Math.abs(mb) >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function ProgressBar({ label, valueMb, maxMb, color = 'bg-blue-500' }: {
  label: string;
  valueMb: number;
  maxMb: number;
  color?: string;
}) {
  const pct = maxMb > 0 ? Math.min(100, Math.abs(valueMb) / maxMb * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-gray-600 dark:text-gray-400">{label}</span>
        <span className="font-mono text-gray-900 dark:text-gray-100">{formatMb(valueMb)}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800">
        <div
          className={`h-2 rounded-full transition-all ${color}`}
          style={{ width: `${Math.max(1, pct)}%` }}
        />
      </div>
    </div>
  );
}

export function MemoryBreakdown({ instanceId, refetchInterval = 30_000 }: { instanceId: string; refetchInterval?: number | false }) {
  const { data, isLoading } = useQuery<BreakdownData | null>({
    queryKey: ['memory-breakdown', instanceId],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/live/memory`);
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval,
  });

  const deficitLabel = data && data.deficit_mb <= 0 ? 'Memory Surplus' : 'Memory Deficit';
  const deficitColor = data && data.deficit_mb <= 0 ? 'bg-emerald-500' : 'bg-red-500';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900 flex flex-col h-full" data-testid="memory-breakdown">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">SQL Memory Breakdown</h3>
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
          Loading...
        </div>
      ) : !data ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Waiting for memory data...</p>
      ) : (
        <div className="flex-1 flex flex-col justify-evenly py-2">
          <ProgressBar label="Total Server Memory" valueMb={data.total_mb} maxMb={data.total_mb} />
          <ProgressBar label="Target Server Memory" valueMb={data.target_mb} maxMb={data.total_mb} />
          <ProgressBar label="Stolen Server Memory" valueMb={data.stolen_mb} maxMb={data.total_mb} color="bg-amber-500" />
          <ProgressBar label="Database Cache Memory" valueMb={data.database_cache_mb} maxMb={data.total_mb} color="bg-emerald-500" />
          <ProgressBar
            label={deficitLabel}
            valueMb={data.deficit_mb}
            maxMb={data.total_mb}
            color={deficitColor}
          />
        </div>
      )}
    </div>
  );
}
