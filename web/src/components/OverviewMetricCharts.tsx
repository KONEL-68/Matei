import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useTheme } from '@/lib/theme';
import { authFetch } from '@/lib/auth';
import { insertGapBreaks, generateTicks } from '@/lib/chart-utils';
import type { TimeWindow } from '@/components/OverviewTimeline';

interface Props {
  instanceId: string;
  window: TimeWindow | null;
}

const CHART_HEIGHT = 180;
const WAIT_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatGB(v: number): string {
  return `${(v / 1024).toFixed(0)}`;
}

interface TPayload {
  dataKey: string;
  value: number;
  color: string;
}

function SimpleTooltip({ active, payload, label, unit }: {
  active?: boolean; payload?: TPayload[]; label?: string | number; unit: string;
}) {
  if (!active || !payload?.length) return null;
  const displayLabel = label != null && typeof label === 'number'
    ? formatTime(new Date(label).toISOString())
    : (label ?? '');
  return (
    <div className="rounded border border-gray-700 bg-gray-900 p-2 text-xs shadow-lg">
      <p className="mb-1 text-gray-400">{displayLabel}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span style={{ color: p.color }}>&#9632;</span>
          <span className="text-gray-300">{p.dataKey}</span>
          <span className="ml-auto font-mono text-white pl-3">{Number(p.value).toFixed(1)}{unit}</span>
        </div>
      ))}
    </div>
  );
}

// ── CPU ──
function CpuMiniChart({ instanceId, rangeParams, dark, timeWindow }: { instanceId: string; rangeParams: string; dark: boolean; timeWindow: TimeWindow | null }) {
  const { data = [] } = useQuery<Array<{ sql_cpu_pct: number; other_process_cpu_pct: number; collected_at: string }>>({
    queryKey: ['overview-cpu', instanceId, rangeParams],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/cpu?${rangeParams}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const mapped = data.map(d => ({
    time: formatTime(d.collected_at),
    ts: new Date(d.collected_at).getTime(),
    'SQL CPU': d.sql_cpu_pct as number | null,
    'Other CPU': d.other_process_cpu_pct as number | null,
  }));
  const chartData = insertGapBreaks(mapped, 'time');

  // Clip x-axis domain to actual data bounds so lines don't droop into empty space
  const timestamps = mapped.map((d) => d.ts);
  const minTs = timestamps.length > 0 ? Math.min(...timestamps) : (timeWindow ? new Date(timeWindow.from).getTime() : 0);
  const maxTs = timestamps.length > 0 ? Math.max(...timestamps) : (timeWindow ? new Date(timeWindow.to).getTime() : 0);
  const axisTicks = generateTicks(minTs, maxTs, 8);

  if (chartData.length === 0) return <EmptyPanel title="CPU Utilization (%)" />;

  return (
    <Panel title="CPU Utilization (%)">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#f0f0f0'} />
          <XAxis dataKey="ts" type="number" domain={[minTs, maxTs]} ticks={axisTicks} fontSize={10} tick={{ fill: dark ? '#6b7280' : '#9ca3af' }} tickFormatter={(v: number) => formatTime(new Date(v).toISOString())} />
          <YAxis domain={[0, 100]} fontSize={10} tick={{ fill: dark ? '#6b7280' : '#9ca3af' }} width={30} />
          <Tooltip content={<SimpleTooltip unit="%" />} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line type="linear" dataKey="SQL CPU" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls={false} />
          <Line type="linear" dataKey="Other CPU" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  );
}

// ── Memory ──
function MemoryMiniChart({ instanceId, rangeParams, dark, timeWindow }: { instanceId: string; rangeParams: string; dark: boolean; timeWindow: TimeWindow | null }) {
  const { data = [] } = useQuery<Array<{
    os_total_memory_mb: number; sql_committed_mb: number; sql_target_mb: number; collected_at: string;
  }>>({
    queryKey: ['overview-mem', instanceId, rangeParams],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/memory?${rangeParams}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const hasDeficit = data.some(d => d.sql_target_mb > d.sql_committed_mb);

  const mapped = data.map(d => {
    const deficit = d.sql_target_mb - d.sql_committed_mb;
    return {
      time: formatTime(d.collected_at),
      ts: new Date(d.collected_at).getTime(),
      'SQL Committed': d.sql_committed_mb as number | null,
      'SQL Target': d.sql_target_mb as number | null,
      ...(hasDeficit ? { 'Memory Deficit': deficit > 0 ? deficit : null } : {}),
    };
  });
  const chartData = insertGapBreaks(mapped, 'time');

  // Clip x-axis domain to actual data bounds so lines don't droop into empty space
  const timestamps = mapped.map((d) => d.ts);
  const minTs = timestamps.length > 0 ? Math.min(...timestamps) : (timeWindow ? new Date(timeWindow.from).getTime() : 0);
  const maxTs = timestamps.length > 0 ? Math.max(...timestamps) : (timeWindow ? new Date(timeWindow.to).getTime() : 0);
  const axisTicks = generateTicks(minTs, maxTs, 8);

  if (chartData.length === 0) return <EmptyPanel title="SQL Memory (GB)" />;

  const allVals = data.flatMap(d => [d.sql_committed_mb, d.sql_target_mb]);
  const minMem = Math.min(...allVals);
  const maxMem = Math.max(...allVals);
  const padding = Math.max((maxMem - minMem) * 0.15, maxMem * 0.05);
  const yMin = Math.max(0, minMem - padding);
  const yMax = maxMem + padding;

  return (
    <Panel title="SQL Memory (GB)">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#f0f0f0'} />
          <XAxis dataKey="ts" type="number" domain={[minTs, maxTs]} ticks={axisTicks} fontSize={10} tick={{ fill: dark ? '#6b7280' : '#9ca3af' }} tickFormatter={(v: number) => formatTime(new Date(v).toISOString())} />
          <YAxis domain={[yMin, yMax]} fontSize={10} tick={{ fill: dark ? '#6b7280' : '#9ca3af' }} width={40} tickFormatter={formatGB} />
          <Tooltip content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            return (
              <div className="rounded border border-gray-700 bg-gray-900 p-2 text-xs shadow-lg">
                <p className="mb-1 text-gray-400">{label != null ? formatTime(new Date(Number(label)).toISOString()) : ''}</p>
                {payload.filter((p: any) => p.value != null).map((p: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <div key={p.dataKey} className="flex items-center gap-2">
                    <span style={{ color: p.color }}>&#9632;</span>
                    <span className="text-gray-300">{p.dataKey}</span>
                    <span className="ml-auto font-mono text-white pl-3">{formatGB(Number(p.value))} GB</span>
                  </div>
                ))}
              </div>
            );
          }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line type="linear" dataKey="SQL Committed" stroke="#8b5cf6" strokeWidth={1.5} dot={false} connectNulls={false} />
          <Line type="linear" dataKey="SQL Target" stroke="#a855f7" strokeWidth={1.5} dot={false} connectNulls={false} />
          {hasDeficit && <Line type="linear" dataKey="Memory Deficit" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="5 3" connectNulls={false} />}
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  );
}

// ── Waits ──
function WaitsMiniChart({ instanceId, rangeParams, dark }: { instanceId: string; rangeParams: string; dark: boolean }) {
  const [hiddenWaits, setHiddenWaits] = useState<Set<string>>(new Set());

  const { data: rawData = [] } = useQuery<Array<{ bucket: string; wait_type: string; wait_ms_per_sec: number }>>({
    queryKey: ['overview-waits', instanceId, rangeParams],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/waits/chart?${rangeParams}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
  });

  if (rawData.length === 0) return <EmptyPanel title="Wait Stats (ms/sec)" />;

  const waitTypes = [...new Set(rawData.map(d => d.wait_type))];
  const bucketMap = new Map<string, Record<string, number | string>>();
  for (const pt of rawData) {
    if (!bucketMap.has(pt.bucket)) {
      bucketMap.set(pt.bucket, { bucket: pt.bucket });
    }
    bucketMap.get(pt.bucket)![pt.wait_type] = pt.wait_ms_per_sec;
  }
  const chartData = [...bucketMap.values()];

  const toggleWait = (dataKey: string) => {
    setHiddenWaits(prev => {
      const next = new Set(prev);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });
  };

  return (
    <Panel title="Wait Stats (ms/sec)">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#f0f0f0'} />
          <XAxis dataKey="bucket" fontSize={10} tick={{ fill: dark ? '#6b7280' : '#9ca3af' }} tickFormatter={formatTime} />
          <YAxis fontSize={10} tick={{ fill: dark ? '#6b7280' : '#9ca3af' }} width={40} />
          <Tooltip content={<SimpleTooltip unit=" ms/s" />} />
          <Legend
            wrapperStyle={{ fontSize: 10, cursor: 'pointer' }}
            onClick={(e: any) => toggleWait(e.dataKey)} // eslint-disable-line @typescript-eslint/no-explicit-any
            formatter={(value: string) => (
              <span style={{ color: hiddenWaits.has(value) ? '#6b7280' : undefined, textDecoration: hiddenWaits.has(value) ? 'line-through' : undefined }}>
                {value}
              </span>
            )}
          />
          {waitTypes.map((wt, i) => (
            <Bar
              key={wt}
              dataKey={wt}
              stackId="a"
              fill={WAIT_COLORS[i % WAIT_COLORS.length]}
              hide={hiddenWaits.has(wt)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

// ── Disk I/O Throughput ──
function DiskIoMiniChart({ instanceId, rangeParams, dark, timeWindow }: { instanceId: string; rangeParams: string; dark: boolean; timeWindow: TimeWindow | null }) {
  const { data: overviewData = [] } = useQuery<Array<{
    bucket: string; disk_read_mb_per_sec: number | null; disk_write_mb_per_sec: number | null;
  }>>({
    queryKey: ['overview-diskio-rw', instanceId, rangeParams],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/overview-chart?${rangeParams}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const mapped = overviewData
    .filter(d => d.disk_read_mb_per_sec != null || d.disk_write_mb_per_sec != null)
    .map(d => ({
      time: formatTime(d.bucket),
      ts: new Date(d.bucket).getTime(),
      'Read': (d.disk_read_mb_per_sec ?? 0) as number | null,
      'Write': (d.disk_write_mb_per_sec ?? 0) as number | null,
    }));
  const chartData = insertGapBreaks(mapped, 'time');

  // Clip x-axis domain to actual data bounds so lines don't droop into empty space
  const timestamps = mapped.map((d) => d.ts);
  const minTs = timestamps.length > 0 ? Math.min(...timestamps) : (timeWindow ? new Date(timeWindow.from).getTime() : 0);
  const maxTs = timestamps.length > 0 ? Math.max(...timestamps) : (timeWindow ? new Date(timeWindow.to).getTime() : 0);
  const axisTicks = generateTicks(minTs, maxTs, 8);

  if (chartData.length === 0) return <EmptyPanel title="Throughput (MB/s)" />;

  return (
    <Panel title="Throughput (MB/s)">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#f0f0f0'} />
          <XAxis dataKey="ts" type="number" domain={[minTs, maxTs]} ticks={axisTicks} fontSize={10} tick={{ fill: dark ? '#6b7280' : '#9ca3af' }} tickFormatter={(v: number) => formatTime(new Date(v).toISOString())} />
          <YAxis fontSize={10} tick={{ fill: dark ? '#6b7280' : '#9ca3af' }} width={40} />
          <Tooltip content={<SimpleTooltip unit=" MB/s" />} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line type="linear" dataKey="Read" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls={false} />
          <Line type="linear" dataKey="Write" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  );
}

// ── Shared ──
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="mb-2 text-xs font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      {children}
    </div>
  );
}

function EmptyPanel({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="mb-2 text-xs font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      <div className="flex items-center justify-center text-xs text-gray-500 dark:text-gray-400" style={{ height: CHART_HEIGHT }}>
        No data
      </div>
    </div>
  );
}

export function OverviewMetricCharts({ instanceId, window }: Props) {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  const rangeParams = window
    ? `from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`
    : 'range=1h';

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="overview-metric-charts">
      <CpuMiniChart instanceId={instanceId} rangeParams={rangeParams} dark={dark} timeWindow={window} />
      <MemoryMiniChart instanceId={instanceId} rangeParams={rangeParams} dark={dark} timeWindow={window} />
      <WaitsMiniChart instanceId={instanceId} rangeParams={rangeParams} dark={dark} />
      <DiskIoMiniChart instanceId={instanceId} rangeParams={rangeParams} dark={dark} timeWindow={window} />
    </div>
  );
}
