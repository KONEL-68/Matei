import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { useTheme } from '@/lib/theme';
import { authFetch } from '@/lib/auth';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { MemoryClerksChart } from '@/components/MemoryClerksChart';
import { generateTicks, insertGapBreaks } from '@/lib/chart-utils';

// ── Types ──

interface SqlServerMetricsProps {
  instanceId: string;
  range: { from: string; to: string };
  health?: { version?: string; edition?: string };
  syncId?: string;
}

interface PerfCounterSeries {
  bucket: string;
  counter_name: string;
  cntr_value: number;
}

interface PerfCounterLatest {
  counter_name: string;
  cntr_value: number;
  collected_at: string;
}

interface PerfCounterResponse {
  latest: PerfCounterLatest[];
  series: PerfCounterSeries[];
}

interface ServerConfigData {
  server_collation: string | null;
  xp_cmdshell: number | null;
  clr_enabled: number | null;
  external_scripts_enabled: number | null;
  remote_access: number | null;
  max_degree_of_parallelism: number | null;
  max_server_memory_mb: number | null;
  cost_threshold_for_parallelism: number | null;
}

interface ChartDef {
  title: string;
  /** Counter names to fetch from series. If two, first is numerator, second is denominator (ratio). */
  counters: string[];
  /** Whether this is a ratio chart (counters[0] / counters[1]) */
  ratio?: boolean;
  /** Whether to render each counter as a separate line on the same chart */
  multiLine?: boolean;
  unit: string;
}

interface TPayload {
  dataKey: string;
  value: number;
  color: string;
}

// ── Constants ──

const CHART_HEIGHT = 140;
const LINE_COLOR = '#3b82f6';
const FILL_COLOR = '#3b82f620';
const MULTI_LINE_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

// ── Chart definitions ──

const GENERAL_CHARTS: ChartDef[] = [
  { title: 'Batch Requests/sec', counters: ['Batch Requests/sec'], unit: '/s' },
  { title: 'SQL Compilations / Batch Requests', counters: ['SQL Compilations/sec', 'Batch Requests/sec'], ratio: true, unit: '' },
  { title: 'Page Splits / Batch Requests', counters: ['Page Splits/sec', 'Batch Requests/sec'], ratio: true, unit: '' },
  { title: 'SQL Compilations/sec', counters: ['SQL Compilations/sec'], unit: '/s' },
  { title: 'Page Splits/sec', counters: ['Page Splits/sec'], unit: '/s' },
  { title: 'Full Scans/sec', counters: ['Full Scans/sec'], unit: '/s' },
  { title: 'User Connections', counters: ['User Connections'], unit: '' },
];

const LATCH_LOCK_CHARTS: ChartDef[] = [
  { title: 'Avg. Latch Wait (ms)', counters: ['Total Latch Wait Time (ms)', 'Latch Waits/sec'], ratio: true, unit: ' ms' },
  { title: 'Lock Timeouts/sec', counters: ['Lock Timeouts/sec'], unit: '/s' },
  { title: 'Lock Waits/sec', counters: ['Lock Waits/sec'], unit: '/s' },
];

const MEMORY_CHARTS: ChartDef[] = [
  { title: 'Page Life Expectancy', counters: ['Page life expectancy'], unit: ' s' },
  { title: 'Memory Grants Pending', counters: ['Memory Grants Pending'], unit: '' },
  { title: 'Memory Grants Outstanding', counters: ['Memory Grants Outstanding'], unit: '' },
];

// ── Helpers ──

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatValue(v: number, unit: string): string {
  if (Math.abs(v) >= 1000) {
    return `${(v / 1000).toFixed(1)}k${unit}`;
  }
  return `${Number(v).toFixed(v % 1 === 0 ? 0 : 2)}${unit}`;
}

function buildChartData(
  series: PerfCounterSeries[],
  chart: ChartDef,
): Array<{ time: string; ts: number; value: number }> {
  if (chart.ratio && chart.counters.length === 2) {
    // Group by bucket, compute ratio
    const bucketMap = new Map<string, { num: number; den: number }>();
    for (const pt of series) {
      if (pt.counter_name === chart.counters[0] || pt.counter_name === chart.counters[1]) {
        if (!bucketMap.has(pt.bucket)) {
          bucketMap.set(pt.bucket, { num: 0, den: 0 });
        }
        const entry = bucketMap.get(pt.bucket)!;
        if (pt.counter_name === chart.counters[0]) entry.num = pt.cntr_value;
        if (pt.counter_name === chart.counters[1]) entry.den = pt.cntr_value;
      }
    }
    return [...bucketMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, { num, den }]) => ({
        time: formatTime(bucket),
        ts: new Date(bucket).getTime(),
        value: den > 0 ? num / den : 0,
      }));
  }

  // Single counter
  const counterName = chart.counters[0];
  return series
    .filter(pt => pt.counter_name === counterName)
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
    .map(pt => ({
      time: formatTime(pt.bucket),
      ts: new Date(pt.bucket).getTime(),
      value: pt.cntr_value,
    }));
}

interface MultiLinePoint {
  time: string;
  ts: number;
  [key: string]: number | string;
}

function buildMultiLineChartData(
  series: PerfCounterSeries[],
  counters: string[],
): MultiLinePoint[] {
  const bucketMap = new Map<string, MultiLinePoint>();
  for (const pt of series) {
    if (!counters.includes(pt.counter_name)) continue;
    if (!bucketMap.has(pt.bucket)) {
      bucketMap.set(pt.bucket, { time: formatTime(pt.bucket), ts: new Date(pt.bucket).getTime() });
    }
    const entry = bucketMap.get(pt.bucket)!;
    entry[pt.counter_name] = pt.cntr_value;
  }
  return [...bucketMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
}

// ── Tooltip ──

function ChartTooltip({ active, payload, label, unit, showLabels }: {
  active?: boolean; payload?: TPayload[]; label?: string | number; unit: string; showLabels?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const displayLabel = label != null && typeof label === 'number'
    ? formatTime(new Date(label).toISOString())
    : (label ?? '');
  return (
    <div className="rounded border border-gray-700 bg-gray-900 p-2 text-xs shadow-lg">
      <p className="mb-1 text-gray-400">{displayLabel}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span style={{ color: p.color }}>&#9632;</span>
          {showLabels && <span className="text-gray-300">{p.dataKey}</span>}
          <span className="ml-auto font-mono text-white pl-3">{formatValue(Number(p.value), unit)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Mini chart ──

function MiniChart({ data, unit, dark, minTs, maxTs, syncId }: {
  data: Array<{ time: string; ts: number; value: number }>;
  unit: string;
  dark: boolean;
  minTs: number;
  maxTs: number;
  syncId?: string;
}) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-gray-500 dark:text-gray-400"
        style={{ height: CHART_HEIGHT }}
      >
        No data
      </div>
    );
  }

  const axisTicks = generateTicks(minTs, maxTs, 6);

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <LineChart data={data} syncId={syncId}>
        <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#f0f0f0'} />
        <XAxis dataKey="ts" type="number" domain={[minTs, maxTs]} ticks={axisTicks} fontSize={9} tick={{ fill: dark ? '#6b7280' : '#9ca3af' }} tickFormatter={(v: number) => formatTime(new Date(v).toISOString())} />
        <YAxis fontSize={9} tick={{ fill: dark ? '#6b7280' : '#9ca3af' }} width={40} tickFormatter={(v: number) => formatValue(v, '')} />
        <Tooltip content={<ChartTooltip unit={unit} />} />
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LINE_COLOR} stopOpacity={0.15} />
            <stop offset="100%" stopColor={LINE_COLOR} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Line
          type="linear"
          dataKey="value"
          stroke={LINE_COLOR}
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          fill="url(#areaFill)"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Multi-line mini chart ──

function MultiLineMiniChart({ data, counters, unit, dark, minTs, maxTs, syncId }: {
  data: MultiLinePoint[];
  counters: string[];
  unit: string;
  dark: boolean;
  minTs: number;
  maxTs: number;
  syncId?: string;
}) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-gray-500 dark:text-gray-400"
        style={{ height: CHART_HEIGHT }}
      >
        No data
      </div>
    );
  }

  const axisTicks = generateTicks(minTs, maxTs, 6);

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <LineChart data={data} syncId={syncId}>
        <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#f0f0f0'} />
        <XAxis dataKey="ts" type="number" domain={[minTs, maxTs]} ticks={axisTicks} fontSize={9} tick={{ fill: dark ? '#6b7280' : '#9ca3af' }} tickFormatter={(v: number) => formatTime(new Date(v).toISOString())} />
        <YAxis fontSize={9} tick={{ fill: dark ? '#6b7280' : '#9ca3af' }} width={40} tickFormatter={(v: number) => formatValue(v, '')} />
        <Tooltip content={<ChartTooltip unit={unit} showLabels />} />
        {counters.map((counter, i) => (
          <Line
            key={counter}
            type="linear"
            dataKey={counter}
            stroke={MULTI_LINE_COLORS[i % MULTI_LINE_COLORS.length]}
            strokeWidth={1.5}
            dot={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Chart panel ──

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
      <h4 className="mb-1 text-xs font-semibold text-gray-900 dark:text-gray-100">{title}</h4>
      {children}
    </div>
  );
}

// ── Chart grid ──

function ChartGrid({ charts, series, dark, minTs, maxTs, syncId }: {
  charts: ChartDef[];
  series: PerfCounterSeries[];
  dark: boolean;
  minTs: number;
  maxTs: number;
  syncId?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {charts.map((chart) => {
        if (chart.multiLine) {
          const data = insertGapBreaks(buildMultiLineChartData(series, chart.counters), 'time');
          return (
            <ChartPanel key={chart.title} title={chart.title}>
              <MultiLineMiniChart data={data} counters={chart.counters} unit={chart.unit} dark={dark} minTs={minTs} maxTs={maxTs} syncId={syncId} />
            </ChartPanel>
          );
        }
        const data = insertGapBreaks(buildChartData(series, chart), 'time');
        return (
          <ChartPanel key={chart.title} title={chart.title}>
            <MiniChart data={data} unit={chart.unit} dark={dark} minTs={minTs} maxTs={maxTs} syncId={syncId} />
          </ChartPanel>
        );
      })}
    </div>
  );
}

// ── Key-value display ──

function KvRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-1.5 last:border-0 dark:border-gray-800">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{value ?? 'N/A'}</span>
    </div>
  );
}

function BoolRow({ label, value }: { label: string; value: number | null | undefined }) {
  const enabled = value === 1;
  const text = value == null ? 'N/A' : enabled ? 'Enabled' : 'Disabled';
  const color = value == null
    ? 'text-gray-400 dark:text-gray-500'
    : enabled
      ? 'text-green-600 dark:text-green-400'
      : 'text-gray-600 dark:text-gray-400';

  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-1.5 last:border-0 dark:border-gray-800">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`text-xs font-medium ${color}`}>{text}</span>
    </div>
  );
}

// ── Main component ──

export function SqlServerMetrics({ instanceId, range, health, syncId }: SqlServerMetricsProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  const rangeParams = `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;

  const { data: perfData } = useQuery<PerfCounterResponse>({
    queryKey: ['sql-metrics-perf', instanceId, rangeParams],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/perf-counters?${rangeParams}`);
      if (!res.ok) return { latest: [], series: [] };
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: serverConfig, isLoading: configLoading, isError: configError } = useQuery<ServerConfigData | null>({
    queryKey: ['sql-metrics-config', instanceId],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/server-config`);
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 300_000,
    retry: 1,
  });

  const series = useMemo(() => perfData?.series ?? [], [perfData]);

  const minTs = new Date(range.from).getTime();
  const maxTs = new Date(range.to).getTime();

  return (
    <CollapsibleSection title="SQL Server Metrics" defaultOpen>
      <div className="space-y-6" data-testid="sql-server-metrics">
        {/* General */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">General</h3>
          <ChartGrid charts={GENERAL_CHARTS} series={series} dark={dark} minTs={minTs} maxTs={maxTs} syncId={syncId} />
        </div>

        {/* Latches and Locks */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Latches and Locks</h3>
          <ChartGrid charts={LATCH_LOCK_CHARTS} series={series} dark={dark} minTs={minTs} maxTs={maxTs} syncId={syncId} />
        </div>

        {/* Memory */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Memory</h3>
          <ChartGrid charts={MEMORY_CHARTS} series={series} dark={dark} minTs={minTs} maxTs={maxTs} syncId={syncId} />
          <div className="mt-3">
            <MemoryClerksChart instanceId={instanceId} rangeParams={rangeParams} syncId={syncId} />
          </div>
        </div>

        {/* Server Properties + Configuration side by side */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Server Properties</h3>
            <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
              <KvRow label="Version" value={health?.version as string | undefined} />
              <KvRow label="Edition" value={health?.edition as string | undefined} />
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Server Configuration Options</h3>
            <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
              {configLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-gray-500 dark:text-gray-400">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
                  Loading...
                </div>
              ) : configError || !serverConfig ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {configError ? 'Failed to load' : 'No data available'}
                </p>
              ) : (
                <>
                  <KvRow label="Collation" value={serverConfig.server_collation} />
                  <BoolRow label="xp_cmdshell" value={serverConfig.xp_cmdshell} />
                  <BoolRow label="CLR" value={serverConfig.clr_enabled} />
                  <BoolRow label="External scripts" value={serverConfig.external_scripts_enabled} />
                  <BoolRow label="Remote access" value={serverConfig.remote_access} />
                  <KvRow label="Max degree of parallelism" value={serverConfig.max_degree_of_parallelism} />
                  <KvRow label="Max server memory (MB)" value={serverConfig.max_server_memory_mb != null ? serverConfig.max_server_memory_mb.toLocaleString() : null} />
                  <KvRow label="Cost threshold for parallelism" value={serverConfig.cost_threshold_for_parallelism} />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
}
