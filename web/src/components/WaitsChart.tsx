import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useTheme } from '@/lib/theme';
import { authFetch } from '@/lib/auth';

interface WaitsChartProps {
  instanceId: string;
  range: string;
  enabled?: boolean;
}

interface RawPoint {
  bucket: string;
  wait_type: string;
  wait_ms_per_sec: number;
}

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

function formatTime(timestamp: string, range: string): string {
  const d = new Date(timestamp);
  if (['7d', '30d', '1y'].includes(range)) {
    return d.toLocaleDateString('pl-PL', { month: '2-digit', day: '2-digit' }) + ' ' +
           d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

interface TooltipPayloadEntry {
  dataKey: string;
  value: number;
  color: string;
}

function WaitsTooltip({ active, payload, label, range }: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  range: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-gray-700 bg-gray-900 p-2 text-xs shadow-lg">
      <p className="mb-1 text-gray-400">{label ? formatTime(label, range) : ''}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span style={{ color: p.color }}>&#9632;</span>
          <span className="text-gray-300">{p.dataKey}</span>
          <span className="ml-auto font-mono text-white">{Number(p.value).toFixed(1)} ms/s</span>
        </div>
      ))}
    </div>
  );
}

export function WaitsChart({ instanceId, range, enabled = true }: WaitsChartProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  const { data: rawData = [] } = useQuery<RawPoint[]>({
    queryKey: ['waits-chart', instanceId, range],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/waits/chart?range=${range}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled,
    refetchInterval: 30_000,
  });

  if (rawData.length === 0) return null;

  // Pivot: group by bucket, one key per wait_type
  const waitTypes = [...new Set(rawData.map((d) => d.wait_type))];
  const bucketMap = new Map<string, Record<string, number | string>>();
  for (const pt of rawData) {
    if (!bucketMap.has(pt.bucket)) {
      bucketMap.set(pt.bucket, { bucket: pt.bucket });
    }
    bucketMap.get(pt.bucket)![pt.wait_type] = pt.wait_ms_per_sec;
  }

  // Fill in empty time buckets so gaps render as empty space in the bar chart
  const sortedBuckets = [...bucketMap.keys()].sort();
  let chartData: Record<string, number | string>[] = [...bucketMap.values()];
  if (sortedBuckets.length >= 2) {
    const timestamps = sortedBuckets.map(b => new Date(b).getTime());
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) intervals.push(timestamps[i] - timestamps[i - 1]);
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    if (median > 0) {
      const filled = new Map(bucketMap);
      for (let t = timestamps[0]; t <= timestamps[timestamps.length - 1]; t += median) {
        const iso = new Date(t).toISOString();
        if (!filled.has(iso)) {
          // Find closest existing bucket to avoid floating point drift
          let found = false;
          for (const key of filled.keys()) {
            if (Math.abs(new Date(key).getTime() - t) < median * 0.3) { found = true; break; }
          }
          if (!found) filled.set(iso, { bucket: iso });
        }
      }
      chartData = [...filled.values()].sort((a, b) =>
        new Date(a.bucket as string).getTime() - new Date(b.bucket as string).getTime()
      );
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Wait Stats Over Time (ms/sec)</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#f0f0f0'} />
          <XAxis
            dataKey="bucket"
            fontSize={11}
            tick={{ fill: dark ? '#9ca3af' : '#6b7280' }}
            tickFormatter={(v: string) => formatTime(v, range)}
          />
          <YAxis fontSize={11} tick={{ fill: dark ? '#9ca3af' : '#6b7280' }} />
          <Tooltip content={<WaitsTooltip range={range} />} />
          <Legend wrapperStyle={{ fontSize: 11, color: dark ? '#d1d5db' : undefined }} />
          {waitTypes.map((wt, i) => (
            <Bar
              key={wt}
              dataKey={wt}
              stackId="a"
              fill={COLORS[i % COLORS.length]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
