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

function formatTime(timestamp: string, range: string): string {
  const d = new Date(timestamp);
  if (['7d', '30d', '1y'].includes(range)) {
    return d.toLocaleDateString('pl-PL', { month: '2-digit', day: '2-digit' }) + ' ' +
           d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function basename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

interface TooltipPayloadEntry {
  dataKey: string;
  value: number;
  color: string;
}

function FileIoTooltip({ active, payload, label, range, fileKeyMap }: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  range: string;
  fileKeyMap: Map<string, string>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-gray-700 bg-gray-900 p-2 text-xs shadow-lg">
      <p className="mb-1 text-gray-400">{label ? formatTime(label, range) : ''}</p>
      {payload.map((p) => {
        const fullPath = fileKeyMap.get(p.dataKey) || p.dataKey;
        return (
          <div key={p.dataKey}>
            <div className="flex items-center gap-2">
              <span style={{ color: p.color }}>&#9632;</span>
              <span className="text-gray-300">{basename(p.dataKey)}</span>
              <span className="ml-auto font-mono text-white">{Number(p.value).toFixed(1)} ms</span>
            </div>
            {fullPath !== basename(p.dataKey) && (
              <div className="ml-4 text-gray-500 truncate max-w-[250px]">{fullPath}</div>
            )}
          </div>
        );
      })}
    </div>
  );
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

  const fileKeys = [...new Set(rawData.map((d) => d.file_key))];

  // Map short basename keys to full paths for tooltip
  const shortKeys = fileKeys.map((fk) => basename(fk));
  const fileKeyMap = new Map<string, string>();
  fileKeys.forEach((fk, i) => fileKeyMap.set(shortKeys[i], fk));

  // Use short names as data keys
  const bucketMap = new Map<string, Record<string, number | string>>();
  for (const pt of rawData) {
    if (!bucketMap.has(pt.bucket)) {
      bucketMap.set(pt.bucket, { bucket: pt.bucket });
    }
    const entry = bucketMap.get(pt.bucket)!;
    const short = basename(pt.file_key);
    entry[short] = Math.max(pt.avg_read_latency_ms, pt.avg_write_latency_ms);
  }

  const chartData = [...bucketMap.values()];
  const uniqueShortKeys = [...new Set(shortKeys)];

  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#f0f0f0'} />
          <XAxis
            dataKey="bucket"
            fontSize={11}
            tick={{ fill: dark ? '#9ca3af' : '#6b7280' }}
            tickFormatter={(v: string) => formatTime(v, range)}
          />
          <YAxis fontSize={11} tick={{ fill: dark ? '#9ca3af' : '#6b7280' }} />
          <Tooltip content={<FileIoTooltip range={range} fileKeyMap={fileKeyMap} />} />
          <Legend wrapperStyle={{ fontSize: 10, color: dark ? '#d1d5db' : undefined }} />
          <ReferenceLine y={20} stroke="#eab308" strokeDasharray="4 4" label={{ value: '20ms', fill: '#eab308', fontSize: 10 }} />
          <ReferenceLine y={50} stroke="#ef4444" strokeDasharray="4 4" label={{ value: '50ms', fill: '#ef4444', fontSize: 10 }} />
          {uniqueShortKeys.map((fk, i) => (
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
