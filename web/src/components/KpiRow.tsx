import { LineChart, Line, ResponsiveContainer } from 'recharts';

interface KpiProps {
  label: string;
  value: string;
  severity: 'ok' | 'warning' | 'critical' | 'nodata';
  sparkData?: number[];
}

const bgColors = {
  ok: 'bg-emerald-600',
  warning: 'bg-yellow-500',
  critical: 'bg-red-600',
  nodata: 'bg-gray-500',
};

const lineColors = {
  ok: '#6ee7b7',
  warning: '#fde68a',
  critical: '#fca5a5',
  nodata: '#9ca3af',
};

function Kpi({ label, value, severity, sparkData }: KpiProps) {
  const chartData = sparkData?.slice(-30).map((v, i) => ({ i, v })) ?? [];

  return (
    <div className={`rounded-lg px-3 py-2 ${bgColors[severity]} text-white flex items-center gap-2 min-w-0`}>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide opacity-80 truncate">{label}</div>
        <div className="text-2xl font-bold leading-tight truncate">{value}</div>
      </div>
      {chartData.length > 2 && (
        <div className="w-16 h-8 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <Line type="monotone" dataKey="v" stroke={lineColors[severity]} strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function severity(value: number, warnThreshold: number, critThreshold: number): 'ok' | 'warning' | 'critical' {
  if (value >= critThreshold) return 'critical';
  if (value >= warnThreshold) return 'warning';
  return 'ok';
}

/** Inverse severity: lower = worse (e.g., Page Life Expectancy). */
export function severityInverse(value: number, warnBelow: number, critBelow: number): 'ok' | 'warning' | 'critical' {
  if (value < critBelow) return 'critical';
  if (value < warnBelow) return 'warning';
  return 'ok';
}

interface PerfCounterLatest {
  counter_name: string;
  cntr_value: number;
}

interface PerfCounterSeries {
  bucket: string;
  counter_name: string;
  cntr_value: number;
}

export interface KpiRowProps {
  perfCounters?: {
    latest: PerfCounterLatest[];
    series: PerfCounterSeries[];
  };
}

function getLatest(counters: PerfCounterLatest[], name: string): number | null {
  const found = counters.find((c) => c.counter_name === name);
  return found ? found.cntr_value : null;
}

function getSpark(series: PerfCounterSeries[], name: string): number[] {
  return series
    .filter((s) => s.counter_name === name)
    .map((s) => s.cntr_value);
}

function formatBatchReqs(v: number | null): string {
  if (v == null) return '\u2014';
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}

function formatConnections(v: number | null): string {
  if (v == null) return '\u2014';
  return String(Math.round(v));
}

function formatDeadlocks(v: number | null): string {
  if (v == null) return '\u2014';
  return v >= 1 ? v.toFixed(1) : v.toFixed(2);
}

function formatPle(v: number | null): string {
  if (v == null) return '\u2014';
  return v >= 3600 ? `${(v / 3600).toFixed(1)}h` : `${Math.round(v)}s`;
}

export function KpiRow({ perfCounters }: KpiRowProps) {
  const latest = perfCounters?.latest ?? [];
  const series = perfCounters?.series ?? [];
  const hasData = latest.length > 0;

  const batchReqs = getLatest(latest, 'Batch Requests/sec');
  const userConns = getLatest(latest, 'User Connections');
  const deadlocks = getLatest(latest, 'Deadlocks/sec');
  const ple = getLatest(latest, 'Page life expectancy');

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="kpi-row">
      <Kpi
        label="Batch Req/s"
        value={formatBatchReqs(batchReqs)}
        severity={!hasData ? 'nodata' : 'ok'}
        sparkData={getSpark(series, 'Batch Requests/sec')}
      />
      <Kpi
        label="Connections"
        value={formatConnections(userConns)}
        severity={!hasData || userConns == null ? 'nodata' : severity(userConns, 100, 500)}
        sparkData={getSpark(series, 'User Connections')}
      />
      <Kpi
        label="Deadlocks/s"
        value={formatDeadlocks(deadlocks)}
        severity={!hasData || deadlocks == null ? 'nodata' : severity(deadlocks, 0.1, 1)}
        sparkData={getSpark(series, 'Deadlocks/sec')}
      />
      <Kpi
        label="Page Life Exp"
        value={formatPle(ple)}
        severity={!hasData || ple == null ? 'nodata' : severityInverse(ple, 1000, 300)}
        sparkData={getSpark(series, 'Page life expectancy')}
      />
    </div>
  );
}
