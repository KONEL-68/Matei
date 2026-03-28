import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { authFetch } from '@/lib/auth';
import type { TimeWindow } from '@/components/OverviewTimeline';
import { insertGapBreaks, generateTicks } from '@/lib/chart-utils';
import { TopQueriesTab } from '@/components/AnalysisSection';

interface SeriesPoint {
  ts: string;
  val: number;
}

interface FileInfo {
  name: string;
  type_desc: string;
  filegroup_name: string | null;
  physical_name: string;
  size_mb: number;
  used_mb: number | null;
  max_size: number;
  growth: number;
  is_percent_growth: boolean;
}

interface DbProperties {
  name: string;
  state_desc: string;
  recovery_model_desc: string;
  compatibility_level: number;
  collation_name: string;
  owner: string;
  owner_name: string;
  create_date: string;
  last_full_backup: string | null;
  last_log_backup: string | null;
}

interface DatabaseDetailData {
  series: Record<string, SeriesPoint[]>;
  properties: DbProperties | null;
  files: FileInfo[] | null;
  vlf_count: number | null;
}

interface DatabaseDetailProps {
  instanceId: string;
  dbName: string;
  timeWindow: TimeWindow | null;
}

function formatSize(mb: number): string {
  if (mb >= 1048576) return `${(mb / 1048576).toFixed(2)} TB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(mb * 1024).toFixed(0)} KB`;
}

function formatSizeKb(kb: number): string {
  return formatSize(kb / 1024);
}

function formatDate(d: string | null): string {
  if (!d) return 'Never';
  return new Date(d).toLocaleString();
}

function formatGrowth(growth: number, isPct: boolean, maxSize: number): string {
  if (isPct) return `${growth}%`;
  const growthMb = growth * 8 / 1024;
  const maxStr = maxSize === -1 ? 'Unlimited' : maxSize === 0 ? 'No growth' : formatSize(maxSize * 8 / 1024);
  return `${formatSize(growthMb)} (max: ${maxStr})`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Small time-series chart used across all 3 columns
function MiniChart({ title, data, unit, color }: {
  title: string;
  data: Array<{ ts: number; val: number | null }>;
  unit: 'kb' | 'rate' | 'pct' | 'count';
  color: string;
}) {
  if (!data || data.length === 0) {
    return (
      <div className="mb-3">
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{title}</div>
        <div className="h-[80px] flex items-center justify-center text-xs text-gray-400">No data</div>
      </div>
    );
  }

  const withGaps = insertGapBreaks(data, 'ts');
  const tsDomain = [data[0].ts, data[data.length - 1].ts] as [number, number];
  const ticks = generateTicks(tsDomain[0], tsDomain[1], 4);

  const formatVal = (v: number) => {
    if (unit === 'kb') return formatSizeKb(v);
    if (unit === 'pct') return `${v.toFixed(1)}%`;
    if (unit === 'count') return v.toFixed(0);
    return v.toFixed(2);
  };

  const latestVal = data[data.length - 1]?.val;

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{title}</span>
        {latestVal != null && (
          <span className="text-xs font-mono text-gray-700 dark:text-gray-300 tabular-nums">{formatVal(latestVal)}</span>
        )}
      </div>
      <div className="h-[80px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={withGaps} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
            <XAxis
              dataKey="ts"
              type="number"
              domain={tsDomain}
              ticks={ticks}
              tickFormatter={formatTime}
              tick={{ fontSize: 10 }}
              stroke="#6b7280"
            />
            <YAxis
              width={50}
              tickFormatter={formatVal}
              tick={{ fontSize: 10 }}
              stroke="#6b7280"
            />
            <Tooltip
              labelFormatter={(v) => formatTime(v as number)}
              formatter={(v: number) => [formatVal(v), title]}
              contentStyle={{ fontSize: 11, backgroundColor: '#1f2937', borderColor: '#374151' }}
              labelStyle={{ color: '#9ca3af' }}
            />
            <Line
              type="monotone"
              dataKey="val"
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}


function vlfSeverity(count: number): string {
  if (count >= 1000) return 'text-red-500';
  if (count >= 500) return 'text-yellow-500';
  return 'text-green-500';
}

export function DatabaseDetail({ instanceId, dbName, timeWindow }: DatabaseDetailProps) {
  const { data, isLoading } = useQuery<DatabaseDetailData>({
    queryKey: ['database-detail', instanceId, dbName, timeWindow?.from, timeWindow?.to],
    queryFn: async () => {
      const params = timeWindow
        ? `from=${encodeURIComponent(timeWindow.from)}&to=${encodeURIComponent(timeWindow.to)}`
        : 'range=1h';
      const res = await authFetch(`/api/metrics/${instanceId}/databases/${encodeURIComponent(dbName)}?${params}`);
      if (!res.ok) return { series: {}, properties: null, files: null, vlf_count: null };
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-gray-500 dark:text-gray-400">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
        Loading database detail...
      </div>
    );
  }

  if (!data) return null;

  const { series, properties, files, vlf_count } = data;

  // Transform series data for charts
  const toChartData = (counterName: string) =>
    (series[counterName] ?? []).map((p) => ({
      ts: new Date(p.ts).getTime(),
      val: p.val,
    }));

  // Compute log used % from size and used size
  const logSizeData = toChartData('Log File(s) Size (KB)');
  const logUsedData = toChartData('Log File(s) Used Size (KB)');
  const logUsedPct = logSizeData.map((point, i) => {
    const used = logUsedData[i]?.val ?? 0;
    const total = point.val;
    return { ts: point.ts, val: total > 0 ? (used / total) * 100 : 0 };
  });

  return (
    <div>
      {/* 3-column metrics grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {/* Column 1: Database Size */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Database Size</h4>
          <MiniChart title="Data File Size" data={toChartData('Data File(s) Size (KB)')} unit="kb" color="#3b82f6" />
          <MiniChart title="Log File Size" data={logSizeData} unit="kb" color="#8b5cf6" />
          <MiniChart title="Log Space Used %" data={logUsedPct} unit="pct" color="#f59e0b" />
        </div>

        {/* Column 2: Log Activity */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Log Activity</h4>
          <MiniChart title="Log Flushes/sec" data={toChartData('Log Flushes/sec')} unit="rate" color="#10b981" />
          <MiniChart title="Log Bytes Flushed/sec" data={toChartData('Log Bytes Flushed/sec')} unit="rate" color="#06b6d4" />
          <MiniChart title="Log Flush Waits/sec" data={toChartData('Log Flush Waits/sec')} unit="rate" color="#ef4444" />
        </div>

        {/* Column 3: Transactions */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Transactions</h4>
          <MiniChart title="Transactions/sec" data={toChartData('Transactions/sec')} unit="rate" color="#3b82f6" />
          <MiniChart title="Active Transactions" data={toChartData('Active Transactions')} unit="count" color="#f59e0b" />
          <MiniChart title="Write Transactions/sec" data={toChartData('Write Transactions/sec')} unit="rate" color="#8b5cf6" />
        </div>
      </div>

      {/* Database properties */}
      {properties && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Properties</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-sm">
            <div><span className="text-gray-500 dark:text-gray-400">State:</span> <span className="text-gray-900 dark:text-gray-100">{properties.state_desc}</span></div>
            <div><span className="text-gray-500 dark:text-gray-400">Recovery:</span> <span className="text-gray-900 dark:text-gray-100">{properties.recovery_model_desc}</span></div>
            <div><span className="text-gray-500 dark:text-gray-400">Compat Level:</span> <span className="text-gray-900 dark:text-gray-100">{properties.compatibility_level}</span></div>
            <div><span className="text-gray-500 dark:text-gray-400">Collation:</span> <span className="text-gray-900 dark:text-gray-100 truncate">{properties.collation_name}</span></div>
            <div><span className="text-gray-500 dark:text-gray-400">Owner:</span> <span className="text-gray-900 dark:text-gray-100">{properties.owner_name ?? properties.owner}</span></div>
            <div><span className="text-gray-500 dark:text-gray-400">Created:</span> <span className="text-gray-900 dark:text-gray-100">{formatDate(properties.create_date)}</span></div>
            <div><span className="text-gray-500 dark:text-gray-400">Last Full Backup:</span> <span className="text-gray-900 dark:text-gray-100">{formatDate(properties.last_full_backup)}</span></div>
            <div><span className="text-gray-500 dark:text-gray-400">Last Log Backup:</span> <span className="text-gray-900 dark:text-gray-100">{formatDate(properties.last_log_backup)}</span></div>
          </div>
        </div>
      )}

      {/* VLF count */}
      {vlf_count != null && (
        <div className="mb-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">VLF Count: </span>
          <span className={`text-sm font-semibold ${vlfSeverity(vlf_count)}`}>
            {vlf_count}
          </span>
          {vlf_count >= 1000 && <span className="text-xs text-red-400 ml-2">High VLF count may impact log performance</span>}
          {vlf_count >= 500 && vlf_count < 1000 && <span className="text-xs text-yellow-400 ml-2">Consider shrinking and regrowing the log file</span>}
        </div>
      )}

      {/* Top Queries for this database */}
      <div className="mb-4">
        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Top Queries</h4>
        <TopQueriesTab instanceId={instanceId} range={timeWindow ? '24h' : '1h'} timeWindow={timeWindow} db={dbName} />
      </div>

      {/* Files table */}
      {files && files.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Files</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  <th className="pb-1.5 pr-3">Name</th>
                  <th className="pb-1.5 pr-3">Type</th>
                  <th className="pb-1.5 pr-3">Filegroup</th>
                  <th className="pb-1.5 pr-3">Path</th>
                  <th className="pb-1.5 pr-3 text-right">Size</th>
                  <th className="pb-1.5 pr-3 text-right">Used</th>
                  <th className="pb-1.5 pr-3 text-right">Used %</th>
                  <th className="pb-1.5">Autogrowth</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => {
                  const usedPct = f.used_mb != null && f.size_mb > 0 ? (f.used_mb / f.size_mb) * 100 : null;
                  return (
                    <tr key={f.name} className="border-b border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-300">
                      <td className="py-1.5 pr-3 font-medium">{f.name}</td>
                      <td className="py-1.5 pr-3">{f.type_desc}</td>
                      <td className="py-1.5 pr-3">{f.filegroup_name ?? '-'}</td>
                      <td className="py-1.5 pr-3 max-w-[200px] truncate" title={f.physical_name}>{f.physical_name}</td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatSize(f.size_mb)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{f.used_mb != null ? formatSize(f.used_mb) : '-'}</td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{usedPct != null ? `${usedPct.toFixed(1)}%` : '-'}</td>
                      <td className="py-1.5">{formatGrowth(f.growth, f.is_percent_growth, f.max_size)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
