import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useTheme } from '@/lib/theme';
import { authFetch } from '@/lib/auth';

interface FileIoChartProps {
  instanceId: string;
  range: string;
}

interface RawPoint {
  bucket: string;
  file_key: string;
  avg_read_latency_ms: number;
  avg_write_latency_ms: number;
}

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function FileIoChart({ instanceId, range }: FileIoChartProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  const { data: rawData = [] } = useQuery<RawPoint[]>({
    queryKey: ['file-io-chart', instanceId, range],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/file-io?range=${range}&mode=chart`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
  });

  if (rawData.length === 0) return null;

  // Pivot: combine read+write latency per file into chart-friendly format
  const fileKeys = [...new Set(rawData.map((d) => d.file_key))];
  const bucketMap = new Map<string, Record<string, number>>();

  for (const pt of rawData) {
    if (!bucketMap.has(pt.bucket)) {
      bucketMap.set(pt.bucket, {});
    }
    const entry = bucketMap.get(pt.bucket)!;
    // Use max of read/write latency as the combined latency for the chart
    entry[pt.file_key] = Math.max(pt.avg_read_latency_ms, pt.avg_write_latency_ms);
  }

  const chartData = [...bucketMap.entries()].map(([bucket, vals]) => ({
    time: formatTime(bucket),
    ...vals,
  }));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">File I/O Latency Over Time (ms)</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData}>
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
            formatter={(value: number) => [`${value.toFixed(1)} ms`]}
          />
          <Legend wrapperStyle={{ fontSize: 10, color: dark ? '#d1d5db' : undefined }} />
          <ReferenceLine y={20} stroke="#eab308" strokeDasharray="4 4" label={{ value: '20ms', fill: '#eab308', fontSize: 10 }} />
          <ReferenceLine y={50} stroke="#ef4444" strokeDasharray="4 4" label={{ value: '50ms', fill: '#ef4444', fontSize: 10 }} />
          {fileKeys.map((fk, i) => (
            <Line
              key={fk}
              type="monotone"
              dataKey={fk}
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
