import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';
import { authFetch } from '@/lib/auth';
import type { TimeWindow } from '@/components/OverviewTimeline';
import { DatabaseDetail } from '@/components/DatabaseDetail';

interface SparkPoint {
  ts: string;
  val: number;
}

interface DatabaseSummary {
  database_name: string;
  state_desc: string;
  data_size_kb: number;
  log_size_kb: number;
  log_used_size_kb: number;
  transactions_per_sec: number;
  active_transactions: number;
  tps_sparkline: SparkPoint[];
  size_sparkline: SparkPoint[];
}

interface DatabasesListProps {
  instanceId: string;
  timeWindow: TimeWindow | null;
}

function formatSize(kb: number): string {
  if (kb >= 1073741824) return `${(kb / 1073741824).toFixed(2)} TB`;
  if (kb >= 1048576) return `${(kb / 1048576).toFixed(2)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

function SparkCell({ data, color, label }: {
  data: SparkPoint[];
  color: string;
  label: string;
}) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const chartData = data.map((d) => ({ t: new Date(d.ts).getTime(), v: d.val }));
  const displayValue = hoverValue ?? (chartData.length > 0 ? chartData[chartData.length - 1].v : 0);

  const handleMouseMove = useCallback((state: { activePayload?: Array<{ payload: { v: number } }> }) => {
    if (state?.activePayload?.[0]) {
      setHoverValue(state.activePayload[0].payload.v);
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoverValue(null);
  }, []);

  return (
    <div className="flex items-center justify-end gap-2">
      <div className="w-[120px] h-[28px]">
        {chartData.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
            >
              <Tooltip content={() => null} />
              <Line
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 2, fill: color }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <span className="text-xs text-gray-400">No data</span>
        )}
      </div>
      <span className="text-gray-700 dark:text-gray-300 min-w-[70px] text-right font-mono text-xs tabular-nums">
        {label === 'tps' ? displayValue.toFixed(2) : formatSize(displayValue)}
      </span>
    </div>
  );
}

function SizeBar({ sizeKb, maxKb }: { sizeKb: number; maxKb: number }) {
  const pct = maxKb > 0 ? Math.min((sizeKb / maxKb) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-600 dark:text-gray-400 font-mono min-w-[70px] text-right tabular-nums">
        {formatSize(sizeKb)}
      </span>
    </div>
  );
}

export function DatabasesList({ instanceId, timeWindow }: DatabasesListProps) {
  const [expandedDb, setExpandedDb] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);

  const { data: databases = [], isLoading } = useQuery<DatabaseSummary[]>({
    queryKey: ['databases-list', instanceId, timeWindow?.from, timeWindow?.to],
    queryFn: async () => {
      const params = timeWindow
        ? `from=${encodeURIComponent(timeWindow.from)}&to=${encodeURIComponent(timeWindow.to)}`
        : 'range=1h';
      const res = await authFetch(`/api/metrics/${instanceId}/databases?${params}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const filtered = search
    ? databases.filter((d) => d.database_name.toLowerCase().includes(search.toLowerCase()))
    : databases;

  const maxSize = Math.max(...filtered.map((d) => d.data_size_kb + d.log_size_kb), 1);
  const totalPages = Math.ceil(filtered.length / perPage);
  const pageStart = page * perPage;
  const pageEnd = pageStart + perPage;
  const paginated = filtered.slice(pageStart, pageEnd);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-gray-500 dark:text-gray-400">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
        Loading databases...
      </div>
    );
  }

  if (databases.length === 0) {
    return <div className="py-4 text-sm text-gray-500 dark:text-gray-400">No database metrics collected yet</div>;
  }

  return (
    <div>
      {/* Header with search and pagination */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search databases"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span>Results per page</span>
          <select
            value={perPage}
            onChange={(e) => { setPerPage(Number(e.target.value)); setPage(0); }}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-1 disabled:opacity-30"
          >
            &larr;
          </button>
          <span>{pageStart + 1}-{Math.min(pageEnd, filtered.length)} of {filtered.length}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-1 disabled:opacity-30"
          >
            &rarr;
          </button>
        </div>
      </div>

      {/* Table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            <th className="pb-2 pr-4">Name</th>
            <th className="pb-2 pr-4 w-[100px]">Status</th>
            <th className="pb-2 pr-4 w-[200px]">Transactions/sec</th>
            <th className="pb-2 w-[280px]">Database size</th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((db) => (
            <tr key={db.database_name} className="group">
              <td colSpan={4} className="p-0">
                {/* Main row */}
                <div
                  className="flex items-center border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 py-3 px-1"
                  onClick={() => setExpandedDb(expandedDb === db.database_name ? null : db.database_name)}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0 pr-4">
                    <span className="text-gray-400 text-xs">{expandedDb === db.database_name ? '\u25BC' : '\u25B6'}</span>
                    <span className="text-blue-600 dark:text-blue-400 font-medium truncate">
                      {db.database_name}
                    </span>
                  </div>
                  <div className="w-[100px] pr-4">
                    <span className={`text-xs font-medium ${db.state_desc === 'ONLINE' ? 'text-emerald-500' : 'text-gray-400'}`}>
                      {db.state_desc}
                    </span>
                  </div>
                  <div className="w-[200px] pr-4">
                    <SparkCell data={db.tps_sparkline} color="#3b82f6" label="tps" />
                  </div>
                  <div className="w-[280px]">
                    <SizeBar sizeKb={db.data_size_kb + db.log_size_kb} maxKb={maxSize} />
                  </div>
                </div>
                {/* Expanded detail */}
                {expandedDb === db.database_name && (
                  <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 px-4 py-4">
                    <DatabaseDetail instanceId={instanceId} dbName={db.database_name} timeWindow={timeWindow} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
