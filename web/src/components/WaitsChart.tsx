import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useTheme } from '@/lib/theme';
import { authFetch } from '@/lib/auth';

interface WaitsChartProps {
  instanceId: string;
  range: string;
}

interface RawPoint {
  bucket: string;
  wait_type: string;
  wait_ms_per_sec: number;
}

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function WaitsChart({ instanceId, range }: WaitsChartProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  const { data: rawData = [] } = useQuery<RawPoint[]>({
    queryKey: ['waits-chart', instanceId, range],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/waits/chart?range=${range}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
  });

  if (rawData.length === 0) return null;

  // Pivot: group by bucket, one key per wait_type
  const waitTypes = [...new Set(rawData.map((d) => d.wait_type))];
  const bucketMap = new Map<string, Record<string, number>>();
  for (const pt of rawData) {
    if (!bucketMap.has(pt.bucket)) {
      bucketMap.set(pt.bucket, { time: 0 } as unknown as Record<string, number>);
    }
    bucketMap.get(pt.bucket)![pt.wait_type] = pt.wait_ms_per_sec;
  }

  const chartData = [...bucketMap.entries()].map(([bucket, vals]) => ({
    time: formatTime(bucket),
    ...vals,
  }));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Wait Stats Over Time (ms/sec)</h3>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#f0f0f0'} />
          <XAxis dataKey="time" fontSize={11} tick={{ fill: dark ? '#9ca3af' : '#6b7280' }} />
          <YAxis fontSize={11} tick={{ fill: dark ? '#9ca3af' : '#6b7280' }} />
          <Tooltip
            contentStyle={{
              fontSize: 12, borderRadius: 8,
              border: dark ? '1px solid #374151' : '1px solid #e5e7eb',
              backgroundColor: dark ? '#1f2937' : '#fff',
              color: dark ? '#e5e7eb' : '#111',
            }}
            formatter={(value: number) => [`${value.toFixed(1)} ms/s`]}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: dark ? '#d1d5db' : undefined }} />
          {waitTypes.map((wt, i) => (
            <Area
              key={wt}
              type="monotone"
              dataKey={wt}
              stackId="1"
              stroke={COLORS[i % COLORS.length]}
              fill={COLORS[i % COLORS.length]}
              fillOpacity={0.3}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
