import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useTheme } from '@/lib/theme';
import { authFetch } from '@/lib/auth';
import { insertGapBreaks, generateTicks } from '@/lib/chart-utils';

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
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

/** Linear regression: returns slope (units per ms) and intercept. */
export function linearRegression(points: Array<{ x: number; y: number }>): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/** Compute days until volume reaches 100%. Returns null if stable/decreasing. */
export function daysUntilFull(points: Array<{ x: number; y: number }>): number | null {
  const { slope, intercept } = linearRegression(points);
  if (slope <= 0) return null; // Stable or decreasing

  const lastX = points[points.length - 1].x;
  const lastY = slope * lastX + intercept;
  if (lastY >= 100) return 0;

  const targetX = (100 - intercept) / slope;
  const daysRemaining = (targetX - lastX) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.round(daysRemaining));
}

export function DiskChart({ instanceId, range }: DiskChartProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  // Disk growth needs at least 6h of data to show a trend; default to 7d
  const effectiveRange = ['1h'].includes(range) ? '7d' : range;

  const { data: rawData = [] } = useQuery<RawPoint[]>({
    queryKey: ['disk-chart', instanceId, effectiveRange],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/disk?range=${effectiveRange}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 60_000,
  });

  if (rawData.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No disk history data yet</p>;
  }

  // Pivot: one line per volume
  const volumes = [...new Set(rawData.map((d) => d.volume_mount_point))];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bucketMap = new Map<string, Record<string, any> & { ts: number }>();

  for (const pt of rawData) {
    if (!bucketMap.has(pt.bucket)) {
      bucketMap.set(pt.bucket, { bucket: pt.bucket, ts: new Date(pt.bucket).getTime() });
    }
    bucketMap.get(pt.bucket)![pt.volume_mount_point] = pt.used_pct;
  }

  const preForecastData = [...bucketMap.entries()]
    .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
    .map(([, vals]) => vals);

  // Compute forecast per volume
  const forecasts: Array<{ volume: string; days: number | null }> = [];
  for (const vol of volumes) {
    const points = rawData
      .filter((d) => d.volume_mount_point === vol)
      .map((d) => ({ x: new Date(d.bucket).getTime(), y: d.used_pct }));
    forecasts.push({ volume: vol, days: daysUntilFull(points) });
  }

  // Add forecast points to chart (extend last 2 points with dashed line)
  const lastBucket = preForecastData[preForecastData.length - 1]?.bucket as string | undefined;
  if (lastBucket) {
    const lastTime = new Date(lastBucket).getTime();
    // Add a forecast point 24h ahead
    const futureTime = lastTime + 24 * 60 * 60 * 1000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const futureEntry: Record<string, any> & { ts: number } = { bucket: new Date(futureTime).toISOString(), ts: futureTime };
    let hasForecast = false;

    for (const vol of volumes) {
      const points = rawData
        .filter((d) => d.volume_mount_point === vol)
        .map((d) => ({ x: new Date(d.bucket).getTime(), y: d.used_pct }));
      const { slope, intercept } = linearRegression(points);
      if (slope > 0) {
        futureEntry[`${vol}_forecast`] = Math.min(100, slope * futureTime + intercept);
        // Also add forecast key to last real point
        const lastVal = preForecastData[preForecastData.length - 1][vol];
        if (lastVal != null) {
          preForecastData[preForecastData.length - 1][`${vol}_forecast`] = lastVal;
        }
        hasForecast = true;
      }
    }
    if (hasForecast) preForecastData.push(futureEntry);
  }

  const chartData = insertGapBreaks(preForecastData, 'bucket');

  // Numeric x-axis domain and ticks
  const allTs = preForecastData.map((d) => d.ts);
  const minTs = Math.min(...allTs);
  const maxTs = Math.max(...allTs);
  const axisTicks = generateTicks(minTs, maxTs, 10);

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#f0f0f0'} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={[minTs, maxTs]}
            ticks={axisTicks}
            fontSize={11}
            tick={{ fill: dark ? '#9ca3af' : '#6b7280' }}
            tickFormatter={(v: number) => formatTime(new Date(v).toISOString())}
          />
          <YAxis domain={[0, 100]} fontSize={11} tick={{ fill: dark ? '#9ca3af' : '#6b7280' }} />
          <Tooltip
            contentStyle={{
              fontSize: 12, borderRadius: 8,
              border: dark ? '1px solid #374151' : '1px solid #e5e7eb',
              backgroundColor: dark ? '#1f2937' : '#fff',
              color: dark ? '#e5e7eb' : '#111',
            }}
            labelFormatter={(v: number) => formatTime(new Date(v).toISOString())}
            formatter={(value: number) => [`${value.toFixed(1)}%`]}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: dark ? '#d1d5db' : undefined }} />
          <ReferenceLine y={90} stroke="#eab308" strokeDasharray="4 4" />
          <ReferenceLine y={95} stroke="#ef4444" strokeDasharray="4 4" />
          {volumes.map((vol, i) => (
            <Line
              key={vol}
              type="linear"
              dataKey={vol}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          ))}
          {volumes.map((vol, i) => (
            <Line
              key={`${vol}_forecast`}
              type="linear"
              dataKey={`${vol}_forecast`}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
              legendType="none"
              connectNulls={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      {/* Forecast labels */}
      <div className="mt-2 flex gap-4 text-xs text-gray-500 dark:text-gray-400">
        {forecasts.map((f) => (
          <span key={f.volume}>
            <span className="font-mono">{f.volume}</span>:{' '}
            {f.days == null ? (
              <span className="text-emerald-600 dark:text-emerald-400">Stable</span>
            ) : f.days === 0 ? (
              <span className="text-red-600 dark:text-red-400">Full</span>
            ) : (
              <span className={f.days < 30 ? 'text-red-600 dark:text-red-400' : 'text-yellow-600 dark:text-yellow-400'}>
                fills in ~{f.days}d
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
