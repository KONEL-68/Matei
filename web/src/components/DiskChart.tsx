import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useTheme } from '@/lib/theme';
import { authFetch } from '@/lib/auth';

interface DiskChartProps {
  instanceId: string;
  range: string;
}

interface RawPoint {
  bucket: string;
  volume_mount_point: string;
  used_pct: number;
}

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function DiskChart({ instanceId, range }: DiskChartProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  // Only fetch chart data for ranges > 1h
  const enabled = range !== '1h';

  const { data: rawData = [] } = useQuery<RawPoint[]>({
    queryKey: ['disk-chart', instanceId, range],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/disk?range=${range}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled,
    refetchInterval: 60_000,
  });

  if (!enabled || rawData.length === 0) return null;

  // Pivot: one line per volume
  const volumes = [...new Set(rawData.map((d) => d.volume_mount_point))];
  const bucketMap = new Map<string, Record<string, number>>();

  for (const pt of rawData) {
    if (!bucketMap.has(pt.bucket)) {
      bucketMap.set(pt.bucket, {});
    }
    bucketMap.get(pt.bucket)![pt.volume_mount_point] = pt.used_pct;
  }

  const chartData = [...bucketMap.entries()].map(([bucket, vals]) => ({
    time: formatTime(bucket),
    ...vals,
  }));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Disk Usage Over Time (%)</h3>
      <ResponsiveContainer width="100%" height={220}>
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
            formatter={(value: number) => [`${value.toFixed(1)}%`]}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: dark ? '#d1d5db' : undefined }} />
          <ReferenceLine y={90} stroke="#eab308" strokeDasharray="4 4" />
          <ReferenceLine y={95} stroke="#ef4444" strokeDasharray="4 4" />
          {volumes.map((vol, i) => (
            <Line
              key={vol}
              type="monotone"
              dataKey={vol}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
