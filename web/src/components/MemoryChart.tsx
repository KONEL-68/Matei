import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useTheme } from '@/lib/theme';
import { insertGapBreaks, generateTicks } from '@/lib/chart-utils';

interface MemoryDataPoint {
  os_total_memory_mb: number;
  os_available_memory_mb: number;
  os_used_memory_mb: number;
  sql_committed_mb: number;
  sql_target_mb: number;
  collected_at: string;
}

interface MemoryChartProps {
  data: MemoryDataPoint[];
  syncId?: string;
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatMB(value: number): string {
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${value} MB`;
}

export function MemoryChart({ data, syncId }: MemoryChartProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  const mapped = data.map((d) => ({
    time: formatTime(d.collected_at),
    ts: new Date(d.collected_at).getTime(),
    'SQL Committed': d.sql_committed_mb as number | null,
    'OS Available': d.os_available_memory_mb as number | null,
    'OS Total': d.os_total_memory_mb as number | null,
  }));
  const chartData = insertGapBreaks(mapped, 'time');

  // Numeric x-axis domain and ticks
  const timestamps = mapped.map((d) => d.ts);
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const axisTicks = generateTicks(minTs, maxTs, 10);

  if (chartData.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-gray-200 bg-white text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
        No memory data available
      </div>
    );
  }

  const maxMem = Math.max(...data.map((d) => d.os_total_memory_mb || 0));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Memory Usage</h3>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} syncId={syncId} syncMethod="value">
          <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#f0f0f0'} />
          <XAxis dataKey="ts" type="number" domain={[minTs, maxTs]} ticks={axisTicks} fontSize={11} tick={{ fill: dark ? '#9ca3af' : '#6b7280' }} tickFormatter={(v: number) => formatTime(new Date(v).toISOString())} />
          <YAxis domain={[0, maxMem]} fontSize={11} tick={{ fill: dark ? '#9ca3af' : '#6b7280' }} tickFormatter={(v) => formatMB(v)} />
          <Tooltip
            contentStyle={{
              fontSize: 12, borderRadius: 8,
              border: dark ? '1px solid #374151' : '1px solid #e5e7eb',
              backgroundColor: dark ? '#1f2937' : '#fff',
              color: dark ? '#e5e7eb' : '#111',
            }}
            labelFormatter={(v: number) => formatTime(new Date(v).toISOString())}
            formatter={(value: number) => [formatMB(value)]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: dark ? '#d1d5db' : undefined }} />
          <Area type="linear" dataKey="SQL Committed" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={dark ? 0.2 : 0.3} strokeWidth={2} dot={false} connectNulls={false} />
          <Area type="linear" dataKey="OS Available" stroke="#10b981" fill="#10b981" fillOpacity={dark ? 0.1 : 0.15} strokeWidth={2} dot={false} connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
