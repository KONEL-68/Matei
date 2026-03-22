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

  const chartData = [...bucketMap.values()];

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
