import { useState, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Line, XAxis, YAxis, ReferenceArea, ResponsiveContainer, Tooltip } from 'recharts';
import { useTheme } from '@/lib/theme';
import { authFetch } from '@/lib/auth';

export interface TimeWindow {
  from: string;
  to: string;
}

interface OverviewTimelineProps {
  instanceId: string;
  window: TimeWindow | null;
  onWindowChange: (w: TimeWindow | null) => void;
}

type OverviewRange = '1h' | '6h' | '24h' | '7d';

interface RawPoint {
  bucket: string;
  cpu_pct: number | null;
  memory_gb: number | null;
  waits_ms_per_sec: number | null;
  disk_io_mb_per_sec: number | null;
}

interface NormalizedPoint {
  bucket: string;
  ts: number;
  cpu: number | null;
  memory: number | null;
  waits: number | null;
  disk_io: number | null;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface TPayload {
  dataKey: string;
  value: number;
  color: string;
}

const LABELS: Record<string, string> = {
  cpu: 'CPU %',
  memory: 'Memory GB',
  waits: 'Waits ms/s',
  disk_io: 'Disk I/O MB/s',
};

function OvTooltip({ active, payload, label }: { active?: boolean; payload?: TPayload[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-gray-700 bg-gray-900 p-2 text-xs shadow-lg">
      <p className="mb-1 text-gray-400">{label ?? ''}</p>
      {payload.filter(p => p.value != null).map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span style={{ color: p.color }}>&#9632;</span>
          <span className="text-gray-300">{LABELS[p.dataKey] ?? p.dataKey}</span>
          <span className="ml-auto font-mono text-white">{Number(p.value).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

export function OverviewTimeline({ instanceId, window, onWindowChange }: OverviewTimelineProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const [overviewRange, setOverviewRange] = useState<OverviewRange>('24h');
  const [selStart, setSelStart] = useState<string | null>(null);
  const [selEnd, setSelEnd] = useState<string | null>(null);
  const isDragging = useRef(false);

  const { data: rawData = [] } = useQuery<RawPoint[]>({
    queryKey: ['overview-chart', instanceId, overviewRange],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/overview-chart?range=${overviewRange}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
  });

  // Normalize each series to 0-100% of its own max
  const normalize = useCallback((): NormalizedPoint[] => {
    if (rawData.length === 0) return [];
    let maxCpu = 0, maxMem = 0, maxWaits = 0, maxIo = 0;
    for (const pt of rawData) {
      if (pt.cpu_pct != null && pt.cpu_pct > maxCpu) maxCpu = pt.cpu_pct;
      if (pt.memory_gb != null && pt.memory_gb > maxMem) maxMem = pt.memory_gb;
      if (pt.waits_ms_per_sec != null && pt.waits_ms_per_sec > maxWaits) maxWaits = pt.waits_ms_per_sec;
      if (pt.disk_io_mb_per_sec != null && pt.disk_io_mb_per_sec > maxIo) maxIo = pt.disk_io_mb_per_sec;
    }
    // Avoid division by zero
    if (maxCpu === 0) maxCpu = 100;
    if (maxMem === 0) maxMem = 1;
    if (maxWaits === 0) maxWaits = 1;
    if (maxIo === 0) maxIo = 1;

    return rawData.map(pt => ({
      bucket: pt.bucket,
      ts: new Date(pt.bucket).getTime(),
      cpu: pt.cpu_pct != null ? (pt.cpu_pct / maxCpu) * 100 : null,
      memory: pt.memory_gb != null ? (pt.memory_gb / maxMem) * 100 : null,
      waits: pt.waits_ms_per_sec != null ? (pt.waits_ms_per_sec / maxWaits) * 100 : null,
      disk_io: pt.disk_io_mb_per_sec != null ? (pt.disk_io_mb_per_sec / maxIo) * 100 : null,
    }));
  }, [rawData]);

  const chartData = normalize();

  const handleMouseDown = useCallback((e: { activeLabel?: string }) => {
    if (e.activeLabel) {
      isDragging.current = true;
      setSelStart(e.activeLabel);
      setSelEnd(e.activeLabel);
    }
  }, []);

  const handleMouseMove = useCallback((e: { activeLabel?: string }) => {
    if (isDragging.current && e.activeLabel) {
      setSelEnd(e.activeLabel);
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    if (isDragging.current && selStart && selEnd) {
      isDragging.current = false;
      const t1 = new Date(selStart).getTime();
      const t2 = new Date(selEnd).getTime();
      const from = t1 < t2 ? selStart : selEnd;
      const to = t1 < t2 ? selEnd : selStart;
      // Only apply if selection is meaningful (> 1 point)
      if (from !== to) {
        onWindowChange({ from, to });
      }
    }
    isDragging.current = false;
  }, [selStart, selEnd, onWindowChange]);

  const quickSelect = useCallback((minutes: number) => {
    const now = new Date();
    const from = new Date(now.getTime() - minutes * 60_000);
    onWindowChange({ from: from.toISOString(), to: now.toISOString() });
  }, [onWindowChange]);

  const resetWindow = useCallback(() => {
    onWindowChange(null);
    setSelStart(null);
    setSelEnd(null);
  }, [onWindowChange]);

  if (chartData.length === 0) return null;

  // Determine reference area for current window
  const refX1 = window ? window.from : null;
  const refX2 = window ? window.to : null;

  // Dragging reference area
  const dragX1 = isDragging.current && selStart ? selStart : null;
  const dragX2 = isDragging.current && selEnd ? selEnd : null;

  const overviewRanges: OverviewRange[] = ['1h', '6h', '24h', '7d'];
  const quickButtons = [
    { label: '15m', minutes: 15 },
    { label: '30m', minutes: 30 },
    { label: '1h', minutes: 60 },
    { label: '3h', minutes: 180 },
    { label: '12h', minutes: 720 },
  ];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900" data-testid="overview-timeline">
      {/* Controls row */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mr-1">Overview:</span>
          {overviewRanges.map(r => (
            <button
              key={r}
              onClick={() => setOverviewRange(r)}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                overviewRange === r
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mr-1">Window:</span>
          {quickButtons.map(q => (
            <button
              key={q.label}
              onClick={() => quickSelect(q.minutes)}
              data-testid={`quick-${q.label}`}
              className="rounded px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors"
            >
              {q.label}
            </button>
          ))}
          <button
            onClick={resetWindow}
            data-testid="reset-window"
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
              !window
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
            }`}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={80}>
        <ComposedChart
          data={chartData}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <XAxis
            dataKey="bucket"
            fontSize={10}
            tick={{ fill: dark ? '#6b7280' : '#9ca3af' }}
            tickFormatter={formatTime}
            height={18}
          />
          <YAxis domain={[0, 100]} hide />
          <Tooltip content={<OvTooltip />} />
          <Line type="monotone" dataKey="cpu" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls />
          <Line type="monotone" dataKey="memory" stroke="#a855f7" strokeWidth={1.5} dot={false} connectNulls />
          <Line type="monotone" dataKey="waits" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls />
          <Line type="monotone" dataKey="disk_io" stroke="#10b981" strokeWidth={1.5} dot={false} connectNulls />
          {/* Current window highlight */}
          {refX1 && refX2 && (
            <ReferenceArea x1={refX1} x2={refX2} fill={dark ? '#3b82f640' : '#3b82f620'} />
          )}
          {/* Drag selection highlight */}
          {dragX1 && dragX2 && (
            <ReferenceArea x1={dragX1} x2={dragX2} fill={dark ? '#f59e0b40' : '#f59e0b30'} />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-1 text-[10px] text-gray-500 dark:text-gray-400">
        <span><span className="inline-block w-2 h-0.5 bg-blue-500 mr-1" />CPU</span>
        <span><span className="inline-block w-2 h-0.5 bg-purple-500 mr-1" />Memory</span>
        <span><span className="inline-block w-2 h-0.5 bg-amber-500 mr-1" />Waits</span>
        <span><span className="inline-block w-2 h-0.5 bg-emerald-500 mr-1" />Disk I/O</span>
        {window && (
          <span className="ml-auto text-blue-500">
            {new Date(window.from).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(window.to).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  );
}
