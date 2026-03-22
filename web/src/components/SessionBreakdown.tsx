interface SessionRow {
  request_status: string | null;
  session_status: string;
  wait_type: string | null;
}

interface SessionBreakdownProps {
  data: SessionRow[];
}

const statusConfig: Record<string, { label: string; dot: string; highlight: (n: number) => string }> = {
  running: {
    label: 'Running',
    dot: 'bg-emerald-500',
    highlight: () => 'text-gray-900 dark:text-gray-100',
  },
  runnable: {
    label: 'Runnable',
    dot: 'bg-yellow-400',
    highlight: (n) => n > 0 ? 'text-yellow-600 dark:text-yellow-400 font-medium' : 'text-gray-900 dark:text-gray-100',
  },
  sleeping: {
    label: 'Sleeping',
    dot: 'bg-gray-400',
    highlight: () => 'text-gray-500 dark:text-gray-400',
  },
  suspended: {
    label: 'Suspended',
    dot: 'bg-red-500',
    highlight: (n) => n > 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-900 dark:text-gray-100',
  },
};

const statusOrder = ['running', 'runnable', 'sleeping', 'suspended'];

export function SessionBreakdown({ data }: SessionBreakdownProps) {
  const counts: Record<string, number> = { running: 0, runnable: 0, sleeping: 0, suspended: 0 };

  // Exclude WAITFOR sessions entirely
  const filtered = data.filter((s) => s.wait_type !== 'WAITFOR');

  for (const s of filtered) {
    const status = (s.request_status || s.session_status || '').toLowerCase();
    if (status in counts) {
      counts[status]++;
    } else {
      counts['sleeping']++;
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900 h-full">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Session Breakdown</h3>
      {filtered.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No session data</p>
      ) : (
        <div className="space-y-2.5">
          {statusOrder.map((key) => {
            const cfg = statusConfig[key];
            const count = counts[key];
            return (
              <div key={key} className="flex items-center gap-2 text-sm">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                <span className="text-gray-600 dark:text-gray-400">{cfg.label}</span>
                <span className={`ml-auto font-mono ${cfg.highlight(count)}`}>{count}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
