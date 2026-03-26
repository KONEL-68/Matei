import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useTheme } from '@/lib/theme';
import { insertGapBreaks } from '@/lib/chart-utils';

interface CpuDataPoint {
  sql_cpu_pct: number;
  other_process_cpu_pct: number;
  system_idle_pct: number;
  collected_at: string;
}

interface CpuChartProps {
  data: CpuDataPoint[];
  height?: number;
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface TooltipPayloadEntry {
  dataKey: string;
  value: number;
  color: string;
}

function CpuTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-gray-700 bg-gray-900 p-2 text-xs shadow-lg">
      <p className="mb-1 text-gray-400">{label ?? ''}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span style={{ color: p.color }}>&#9632;</span>
          <span className="text-gray-300">{p.dataKey}</span>
          <span className="ml-auto font-mono text-white">{p.value}%</span>
        </div>
      ))}
    </div>
  );
}

export function CpuChart({ data, height = 280 }: CpuChartProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  const mapped = data.map((d) => ({
    time: formatTime(d.collected_at),
    ts: new Date(d.collected_at).getTime(),
    'SQL CPU': d.sql_cpu_pct as number | null,
    'Other CPU': d.other_process_cpu_pct as number | null,
  }));
  const chartData = insertGapBreaks(mapped, 'time');

  if (chartData.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-gray-200 bg-white text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
        No CPU data available
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">CPU Utilization (%)</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#f0f0f0'} />
          <XAxis dataKey="time" fontSize={11} tick={{ fill: dark ? '#9ca3af' : '#6b7280' }} />
          <YAxis domain={[0, 100]} fontSize={11} tick={{ fill: dark ? '#9ca3af' : '#6b7280' }} />
          <Tooltip content={<CpuTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, color: dark ? '#d1d5db' : undefined }} />
          <Line type="monotone" dataKey="SQL CPU" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls={false} />
          <Line type="monotone" dataKey="Other CPU" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
