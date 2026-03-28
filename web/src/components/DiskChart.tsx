import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useTheme } from '@/lib/theme';
import { authFetch } from '@/lib/auth';
import { generateTicks } from '@/lib/chart-utils';

interface DiskChartProps {
  instanceId: string;
  range: string;
  syncId?: string;
}

interface RawPoint {
  bucket: string;
  volume_mount_point: string;
  used_pct: number;
}

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Linear regression with centered X for numerical stability. Returns slope (units per ms) and intercept. */
export function linearRegression(points: Array<{ x: number; y: number }>): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0 };

  const xOffset = points[0].x;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of points) {
    const cx = p.x - xOffset;
    sumX += cx;
    sumY += p.y;
    sumXY += cx * p.y;
    sumX2 += cx * cx;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const cIntercept = (sumY - slope * sumX) / n;
  return { slope, intercept: cIntercept - slope * xOffset };
}

/**
 * Holt's Linear Trend (Double Exponential Smoothing) for disk growth forecasting.
 *
 * Maintains a smoothed level and trend component that adapt to changing growth
 * rates over time. Handles irregular time spacing by scaling the trend
 * proportionally to the time gap between observations.
 *
 * @param points  Sorted array of { x: timestamp ms, y: used_pct }
 * @param alpha   Level smoothing factor (0–1, default 0.3)
 * @param beta    Trend smoothing factor (0–1, default 0.1)
 * @returns { level, trend, growthPerDay } where trend is per-ms rate
 */
export function holtLinearTrend(
  points: Array<{ x: number; y: number }>,
  alpha = 0.3,
  beta = 0.1,
): { level: number; trend: number; growthPerDay: number } {
  const n = points.length;
  if (n === 0) return { level: 0, trend: 0, growthPerDay: 0 };
  if (n === 1) return { level: points[0].y, trend: 0, growthPerDay: 0 };

  const MS_PER_DAY = 86_400_000;

  // Initialize: level = first value, trend = average slope over first two points
  const dt0 = points[1].x - points[0].x;
  let level = points[0].y;
  let trend = dt0 > 0 ? (points[1].y - points[0].y) / dt0 : 0;

  // Iterate from second point onward
  for (let i = 1; i < n; i++) {
    const dt = points[i].x - points[i - 1].x;
    if (dt <= 0) continue;

    // Scale trend to this interval's time gap (handles irregular spacing)
    const predictedLevel = level + trend * dt;

    const prevLevel = level;
    level = alpha * points[i].y + (1 - alpha) * predictedLevel;
    trend = beta * ((level - prevLevel) / dt) + (1 - beta) * trend;
  }

  const growthPerDay = trend * MS_PER_DAY;

  return { level, trend, growthPerDay };
}

/** Compute days until volume reaches 100%. Returns null if stable/decreasing. */
export function daysUntilFull(points: Array<{ x: number; y: number }>): { days: number | null; growthPerDay: number } {
  const { level, growthPerDay } = holtLinearTrend(points);

  // Consider stable if growth is negligible (<0.01%/day → would take >10,000 days)
  if (growthPerDay <= 0 || Math.abs(growthPerDay) < 0.01) return { days: null, growthPerDay };

  if (level >= 100) return { days: 0, growthPerDay };

  const remaining = 100 - level;
  if (remaining <= 0) return { days: 0, growthPerDay };

  const daysRemaining = remaining / growthPerDay;
  if (!isFinite(daysRemaining) || daysRemaining > 100000) return { days: null, growthPerDay };

  return { days: Math.max(0, Math.round(daysRemaining)), growthPerDay };
}

export function DiskChart({ instanceId, range, syncId }: DiskChartProps) {
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
  const forecasts: Array<{ volume: string; days: number | null; growthPerDay: number }> = [];
  for (const vol of volumes) {
    const points = rawData
      .filter((d) => d.volume_mount_point === vol)
      .map((d) => ({ x: new Date(d.bucket).getTime(), y: d.used_pct }));
    const { days, growthPerDay } = daysUntilFull(points);
    forecasts.push({ volume: vol, days, growthPerDay });
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
      const { level, trend, growthPerDay } = holtLinearTrend(points);
      const lastVal = preForecastData[preForecastData.length - 1][vol];
      if (lastVal != null) {
        // For stable/declining drives, extend flat; for growing drives, extrapolate
        const projected = growthPerDay >= 0.01
          ? Math.min(100, Math.max(0, level + trend * (futureTime - lastTime)))
          : lastVal;
        futureEntry[`${vol}_forecast`] = projected;
        preForecastData[preForecastData.length - 1][`${vol}_forecast`] = lastVal;
        hasForecast = true;
      }
    }
    if (hasForecast) preForecastData.push(futureEntry);
  }

  // Disk usage is continuous — don't insert gap breaks (disk space doesn't
  // reset when the backend goes offline, unlike rate-based metrics).
  const chartData = preForecastData;

  // Numeric x-axis domain and ticks
  const allTs = preForecastData.map((d) => d.ts);
  const minTs = Math.min(...allTs);
  const maxTs = Math.max(...allTs);
  const axisTicks = generateTicks(minTs, maxTs, 10);

  // Auto-scale Y-axis: compute domain from actual data with ~10% padding
  const allValues: number[] = [];
  for (const pt of chartData) {
    for (const vol of volumes) {
      const v = pt[vol] as number | undefined;
      if (v != null) allValues.push(v);
      const fv = pt[`${vol}_forecast`] as number | undefined;
      if (fv != null) allValues.push(fv);
    }
  }
  const dataMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const dataMax = allValues.length > 0 ? Math.max(...allValues) : 100;
  const dataRange = dataMax - dataMin || 10;
  const yMin = Math.max(0, Math.floor(dataMin - dataRange * 0.1));
  const yMax = Math.min(100, Math.ceil(dataMax + dataRange * 0.1));

  // Only show threshold lines when they fall within or near the visible Y-axis range
  const showWarning90 = yMax >= 88;
  const showCritical95 = yMax >= 93;

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={chartData} syncId={syncId} syncMethod="value">
          <defs>
            {volumes.map((vol, i) => (
              <linearGradient key={`grad-${vol}`} id={`diskGrad-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.3} />
                <stop offset="100%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
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
          <YAxis domain={[yMin, yMax]} fontSize={11} tick={{ fill: dark ? '#9ca3af' : '#6b7280' }} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              // Merge: prefer real value, fall back to forecast
              const merged = new Map<string, { value: number; color: string; forecastOnly: boolean }>();
              for (const entry of payload) {
                const name = entry.dataKey as string;
                const val = entry.value as number;
                if (val == null) continue;
                const isForecast = name.endsWith('_forecast');
                const vol = isForecast ? name.replace('_forecast', '') : name;
                if (!merged.has(vol)) {
                  merged.set(vol, { value: val, color: entry.color ?? '#fff', forecastOnly: isForecast });
                } else if (!isForecast) {
                  // Real value takes priority; mark as not forecast-only
                  merged.get(vol)!.forecastOnly = false;
                }
              }
              return (
                <div style={{
                  fontSize: 12, borderRadius: 8, padding: '8px 12px',
                  border: dark ? '1px solid #374151' : '1px solid #e5e7eb',
                  backgroundColor: dark ? '#1f2937' : '#fff',
                  color: dark ? '#e5e7eb' : '#111',
                }}>
                  <div style={{ marginBottom: 4 }}>{new Date(label).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                  {[...merged.entries()].map(([vol, { value, color, forecastOnly }]) => (
                    <div key={vol} style={{ color }}>
                      {vol}{forecastOnly ? ' (forecast)' : ''}: {value.toFixed(1)}%
                    </div>
                  ))}
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: dark ? '#d1d5db' : undefined }} />
          {showWarning90 && <ReferenceLine y={90} stroke="#eab308" strokeDasharray="4 4" label={{ value: '90%', position: 'right', fontSize: 10, fill: '#eab308' }} />}
          {showCritical95 && <ReferenceLine y={95} stroke="#ef4444" strokeDasharray="4 4" label={{ value: '95%', position: 'right', fontSize: 10, fill: '#ef4444' }} />}
          {volumes.map((vol, i) => (
            <Area
              key={`area-${vol}`}
              type="linear"
              dataKey={vol}
              stroke="none"
              fill={`url(#diskGrad-${i})`}
              fillOpacity={1}
              connectNulls
              legendType="none"
              tooltipType="none"
              isAnimationActive={false}
            />
          ))}
          {volumes.map((vol, i) => (
            <Line
              key={vol}
              type="linear"
              dataKey={vol}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
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
      <div className="mt-2 flex items-center gap-4 flex-wrap text-xs text-gray-500 dark:text-gray-400">
        <span className="italic">Forecast: Holt's Linear Trend — adapts to changing growth rates</span>
        <span className="text-gray-400 dark:text-gray-600">|</span>
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
            {f.growthPerDay > 0.01 && (
              <span className="text-gray-400 dark:text-gray-500 ml-1">
                ({f.growthPerDay.toFixed(2)}%/day)
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
