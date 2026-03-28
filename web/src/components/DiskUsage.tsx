import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';
import { authFetch } from '@/lib/auth';
import type { TimeWindow } from '@/components/OverviewTimeline';

interface SparkPoint {
  t: number;
  v: number;
}

interface DiskVolume {
  volume_mount_point: string;
  logical_volume_name: string;
  total_mb: number;
  available_mb: number;
  used_mb: number;
  used_pct: number;
  avg_read_latency_ms: number;
  avg_write_latency_ms: number;
  transfers_per_sec: number;
  sparklines: {
    read_latency: SparkPoint[];
    write_latency: SparkPoint[];
    transfers: SparkPoint[];
  };
}

interface DiskUsageProps {
  instanceId: string;
  timeWindow: TimeWindow | null;
  syncId?: string;
}

function formatSize(mb: number): string {
  if (mb >= 1048576) return `${(mb / 1048576).toFixed(2)} TB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb} MB`;
}

function diskLabel(vol: DiskVolume): string {
  const mount = vol.volume_mount_point.replace(/\\$/, '');
  if (vol.logical_volume_name) return `${vol.logical_volume_name} (${mount})`;
  return mount;
}

function barColor(pct: number): string {
  if (pct > 90) return 'bg-red-500';
  if (pct > 75) return 'bg-yellow-500';
  return 'bg-blue-500';
}

function formatMs(v: number): string {
  if (v >= 1) return `${v.toFixed(1)} ms`;
  return `${v.toFixed(3)} ms`;
}

// Interactive mini line chart with hover value
function SparkCell({ data, color, unit, fallbackValue, syncId }: {
  data: SparkPoint[];
  color: string;
  unit: 'ms' | 'num';
  fallbackValue: number;
  syncId?: string;
}) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);

  const displayValue = hoverValue ?? (data.length > 0 ? data[data.length - 1].v : fallbackValue);
  const formatted = unit === 'ms' ? formatMs(displayValue) : displayValue.toFixed(1);

  const handleMouseMove = useCallback((state: { activePayload?: Array<{ payload: SparkPoint }> }) => {
    if (state?.activePayload?.[0]) {
      setHoverValue(state.activePayload[0].payload.v);
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoverValue(null);
  }, []);

  return (
    <div className="flex items-center justify-end gap-2">
      <div className="w-[120px] h-[28px]">
        {data.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              syncId={syncId}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
            >
              <Tooltip content={() => null} />
              <Line
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 2, fill: color }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="w-full h-full" />
        )}
      </div>
      <span className="text-gray-700 dark:text-gray-300 min-w-[70px] text-right font-mono text-xs tabular-nums">
        {formatted}
      </span>
    </div>
  );
}

export function DiskUsage({ instanceId, timeWindow, syncId }: DiskUsageProps) {
  const { data: volumes = [], isLoading } = useQuery<DiskVolume[]>({
    queryKey: ['disk-usage', instanceId, timeWindow?.from, timeWindow?.to],
    queryFn: async () => {
      const params = timeWindow
        ? `from=${encodeURIComponent(timeWindow.from)}&to=${encodeURIComponent(timeWindow.to)}`
        : 'range=1h';
      const res = await authFetch(`/api/metrics/${instanceId}/disk-usage?${params}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const sorted = [...volumes].sort((a, b) => {
    if (a.logical_volume_name && !b.logical_volume_name) return -1;
    if (!a.logical_volume_name && b.logical_volume_name) return 1;
    return a.volume_mount_point.localeCompare(b.volume_mount_point);
  });

  return (
    <div>
      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-gray-500 dark:text-gray-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
          Loading disk usage...
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4">No disk data available.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="py-2 pr-3 w-32">Disk</th>
                <th className="py-2 pr-3 min-w-[200px]">Space used</th>
                <th className="py-2 pr-3 text-right min-w-[200px]">Avg. read time</th>
                <th className="py-2 pr-3 text-right min-w-[200px]">Avg. write time</th>
                <th className="py-2 text-right min-w-[200px]">Transfers/sec</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((vol) => {
                const pct = Number(vol.used_pct);
                return (
                  <tr key={vol.volume_mount_point} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-3 pr-3 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                      {diskLabel(vol)}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 flex-1 min-w-[120px] rounded-full bg-gray-100 dark:bg-gray-800">
                          <div
                            className={`h-2.5 rounded-full transition-all ${barColor(pct)}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                        {formatSize(vol.available_mb)} free of {formatSize(vol.total_mb)}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <SparkCell
                        data={vol.sparklines.read_latency}
                        color="#3b82f6"
                        unit="ms"
                        fallbackValue={vol.avg_read_latency_ms}
                        syncId={syncId}
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <SparkCell
                        data={vol.sparklines.write_latency}
                        color="#f59e0b"
                        unit="ms"
                        fallbackValue={vol.avg_write_latency_ms}
                        syncId={syncId}
                      />
                    </td>
                    <td className="py-3">
                      <SparkCell
                        data={vol.sparklines.transfers}
                        color="#10b981"
                        unit="num"
                        fallbackValue={vol.transfers_per_sec}
                        syncId={syncId}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
