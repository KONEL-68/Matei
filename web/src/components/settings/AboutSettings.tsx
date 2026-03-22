import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';

interface CollectorStatus {
  running: boolean;
  lastCycleMs: number | null;
  lastCycleAt: string | null;
  instancesCount: number;
  lastSuccess: number;
  lastFailed: number;
}

export function AboutSettings() {
  const { data: status } = useQuery<CollectorStatus>({
    queryKey: ['collector-status'],
    queryFn: async () => {
      const res = await authFetch('/api/collector/status');
      if (!res.ok) throw new Error('Failed to load status');
      return res.json();
    },
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Application</h4>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-500 dark:text-gray-400">Name</dt>
          <dd className="text-gray-900 dark:text-gray-100">Matei</dd>
          <dt className="text-gray-500 dark:text-gray-400">Version</dt>
          <dd className="text-gray-900 dark:text-gray-100">0.1.0</dd>
          <dt className="text-gray-500 dark:text-gray-400">License</dt>
          <dd className="text-gray-900 dark:text-gray-100">MIT</dd>
        </dl>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Collector Status</h4>
        {status ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">Running</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              <span className={`inline-block h-2 w-2 rounded-full mr-1 ${status.running ? 'bg-green-500' : 'bg-red-500'}`} />
              {status.running ? 'Yes' : 'No'}
            </dd>
            <dt className="text-gray-500 dark:text-gray-400">Instances</dt>
            <dd className="text-gray-900 dark:text-gray-100">{status.instancesCount}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Last Cycle</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {status.lastCycleMs != null ? `${status.lastCycleMs}ms` : '-'}
              {status.lastCycleAt && (
                <span className="ml-1 text-gray-400 dark:text-gray-500">
                  ({new Date(status.lastCycleAt).toLocaleTimeString()})
                </span>
              )}
            </dd>
            <dt className="text-gray-500 dark:text-gray-400">Last Result</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              <span className="text-green-600 dark:text-green-400">{status.lastSuccess} ok</span>
              {status.lastFailed > 0 && (
                <span className="ml-2 text-red-600 dark:text-red-400">{status.lastFailed} failed</span>
              )}
            </dd>
          </dl>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
        )}
      </div>
    </div>
  );
}
