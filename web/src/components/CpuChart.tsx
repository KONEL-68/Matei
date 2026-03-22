import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useTheme } from '@/lib/theme';

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

export function CpuChart({ data, height = 280 }: CpuChartProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  const chartData = data.map((d) => ({
    time: formatTime(d.collected_at),
    'SQL CPU': d.sql_cpu_pct,
    'Other CPU': d.other_process_cpu_pct,
    'Idle': d.system_idle_pct,
  }));

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
          <Tooltip
            contentStyle={{
              fontSize: 12, borderRadius: 8,
              border: dark ? '1px solid #374151' : '1px solid #e5e7eb',
              backgroundColor: dark ? '#1f2937' : '#fff',
              color: dark ? '#e5e7eb' : '#111',
            }}
            formatter={(value: number) => [`${value}%`]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: dark ? '#d1d5db' : undefined }} />
          <Line type="monotone" dataKey="SQL CPU" stroke="#3b82f6" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="Other CPU" stroke="#f59e0b" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="Idle" stroke={dark ? '#4b5563' : '#d1d5db'} strokeWidth={1} dot={false} strokeDasharray="4 4" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
