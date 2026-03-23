import { useState, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
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

interface ChartPoint {
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
  cpu: 'CPU',
  memory: 'Memory',
  waits: 'Waits',
  disk_io: 'Disk I/O',
};
const UNITS: Record<string, string> = {
  cpu: '%',
  memory: ' GB',
  waits: ' ms/s',
  disk_io: ' MB/s',
};

function OvTooltip({ active, payload, label }: { active?: boolean; payload?: TPayload[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-gray-700 bg-gray-900 p-2 text-xs shadow-lg">
      <p className="mb-1 text-gray-400">{label ? formatTime(label) : ''}</p>
      {payload.filter(p => p.value != null).map((p) => {
        const unit = UNITS[p.dataKey] ?? '';
        return (
          <div key={p.dataKey} className="flex items-center gap-2">
            <span style={{ color: p.color }}>&#9632;</span>
            <span className="text-gray-300">{LABELS[p.dataKey] ?? p.dataKey}</span>
            <span className="ml-auto font-mono text-white">
              {Number(p.value).toFixed(1)}{unit}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const METRICS = [
  { key: 'cpu', label: 'CPU', color: '#3b82f6', dotClass: 'bg-blue-500' },
  { key: 'memory', label: 'Memory', color: '#a855f7', dotClass: 'bg-purple-500' },
  { key: 'waits', label: 'Waits', color: '#f59e0b', dotClass: 'bg-amber-500' },
  { key: 'disk_io', label: 'Disk I/O', color: '#10b981', dotClass: 'bg-emerald-500' },
] as const;

// Recharts chart margins — needed to calculate data area offset for drag overlay
const CHART_MARGIN = { left: 0, right: 0, top: 4, bottom: 0 };

export function OverviewTimeline({ instanceId, window, onWindowChange }: OverviewTimelineProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const [overviewRange, setOverviewRange] = useState<OverviewRange>('24h');
  const [activeMetrics, setActiveMetrics] = useState<Set<string>>(new Set(['cpu', 'memory', 'waits', 'disk_io']));

  // Native DOM drag selection
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [dragCurrentX, setDragCurrentX] = useState<number | null>(null);
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

  // Use raw values directly — CPU on left axis (0-100), others on right axis (auto)
  const chartData: ChartPoint[] = rawData.map(pt => ({
    bucket: pt.bucket,
    ts: new Date(pt.bucket).getTime(),
    cpu: pt.cpu_pct,
    memory: pt.memory_gb,
    waits: pt.waits_ms_per_sec,
    disk_io: pt.disk_io_mb_per_sec,
  }));

  // Convert pixel X position to a timestamp from chart data
  const pixelToTimestamp = useCallback((px: number): string | null => {
    if (!chartWrapRef.current || chartData.length === 0) return null;
    const rect = chartWrapRef.current.getBoundingClientRect();
    // Recharts reserves ~60px for Y axis on left side. Estimate chart area.
    const chartLeft = 5; // minimal left margin since Y axes are hidden
    const chartRight = rect.width - 5;
    const chartWidth = chartRight - chartLeft;
    const pct = Math.max(0, Math.min(1, (px - chartLeft) / chartWidth));
    const idx = Math.round(pct * (chartData.length - 1));
    return chartData[Math.max(0, Math.min(chartData.length - 1, idx))].bucket;
  }, [chartData]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    const rect = chartWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    isDragging.current = true;
    setDragStartX(x);
    setDragCurrentX(x);
  }, []);

  const handleDragMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const rect = chartWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    setDragCurrentX(x);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (!isDragging.current || dragStartX == null || dragCurrentX == null) {
      isDragging.current = false;
      setDragStartX(null);
      setDragCurrentX(null);
      return;
    }
    isDragging.current = false;

    const left = Math.min(dragStartX, dragCurrentX);
    const right = Math.max(dragStartX, dragCurrentX);

    // Only register if drag was at least 10px
    if (right - left > 10) {
      const from = pixelToTimestamp(left);
      const to = pixelToTimestamp(right);
      if (from && to && from !== to) {
        onWindowChange({ from, to });
      }
    }

    setDragStartX(null);
    setDragCurrentX(null);
  }, [dragStartX, dragCurrentX, pixelToTimestamp, onWindowChange]);

  // Compute an overlay position in pixels from a from/to pair
  const tsToOverlay = useCallback((from: string, to: string): { left: number; width: number } | null => {
    if (!chartWrapRef.current || chartData.length === 0) return null;
    const rect = chartWrapRef.current.getBoundingClientRect();
    const chartLeft = 5;
    const chartRight = rect.width - 5;
    const chartWidth = chartRight - chartLeft;

    const firstTs = chartData[0].ts;
    const lastTs = chartData[chartData.length - 1].ts;
    const totalMs = lastTs - firstTs;
    if (totalMs <= 0) return null;

    const fromTs = new Date(from).getTime();
    const toTs = new Date(to).getTime();
    const pctLeft = Math.max(0, Math.min(1, (fromTs - firstTs) / totalMs));
    const pctRight = Math.max(0, Math.min(1, (toTs - firstTs) / totalMs));

    return {
      left: chartLeft + pctLeft * chartWidth,
      width: (pctRight - pctLeft) * chartWidth,
    };
  }, [chartData]);

  const quickSelect = useCallback((minutes: number) => {
    const now = new Date();
    const from = new Date(now.getTime() - minutes * 60_000);
    onWindowChange({ from: from.toISOString(), to: now.toISOString() });
  }, [onWindowChange]);

  const resetWindow = useCallback(() => {
    onWindowChange(null);
  }, [onWindowChange]);

  const toggleMetric = useCallback((key: string) => {
    setActiveMetrics(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (chartData.length === 0) return null;

  const overviewRanges: OverviewRange[] = ['1h', '6h', '24h', '7d'];
  const quickButtons = [
    { label: '15m', minutes: 15 },
    { label: '30m', minutes: 30 },
    { label: '1h', minutes: 60 },
    { label: '3h', minutes: 180 },
    { label: '12h', minutes: 720 },
  ];

  // Drag overlay — only visible while mouse button is held
  const dragOv = (dragStartX != null && dragCurrentX != null) ? {
    left: Math.min(dragStartX, dragCurrentX),
    width: Math.abs(dragCurrentX - dragStartX),
  } : null;

  // Selected window indicator — visible after selection, until Reset
  const winOv = window ? tsToOverlay(window.from, window.to) : null;

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

      {/* Metric toggles */}
      <div className="flex items-center gap-3 mb-2" data-testid="metric-toggles">
        {METRICS.map(m => (
          <label key={m.key} className="flex items-center gap-1.5 cursor-pointer text-[11px] text-gray-600 dark:text-gray-400 select-none">
            <input
              type="checkbox"
              checked={activeMetrics.has(m.key)}
              onChange={() => toggleMetric(m.key)}
              className="sr-only"
              data-testid={`toggle-${m.key}`}
            />
            <span className={`inline-block w-3 h-3 rounded-sm border-2 flex items-center justify-center ${
              activeMetrics.has(m.key)
                ? `border-transparent ${m.dotClass}`
                : 'border-gray-300 dark:border-gray-600'
            }`}>
              {activeMetrics.has(m.key) && (
                <svg className="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            {m.label}
          </label>
        ))}
      </div>

      {/* Chart with native DOM drag overlay */}
      <div
        ref={chartWrapRef}
        className="relative select-none"
        onMouseDown={handleDragStart}
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
        data-testid="chart-area"
      >
        <ResponsiveContainer width="100%" height={150}>
          <ComposedChart data={chartData} margin={CHART_MARGIN}>
            <XAxis
              dataKey="bucket"
              fontSize={10}
              tick={{ fill: dark ? '#6b7280' : '#9ca3af' }}
              tickFormatter={formatTime}
              height={18}
            />
            {/* Left Y axis: CPU % (fixed 0-100) */}
            <YAxis yAxisId="pct" domain={[0, 100]} hide />
            {/* Right Y axis: auto-scaled for memory/waits/disk_io */}
            <YAxis yAxisId="auto" orientation="right" hide />
            <Tooltip content={<OvTooltip />} />
            {activeMetrics.has('cpu') && <Line yAxisId="pct" type="monotone" dataKey="cpu" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
            {activeMetrics.has('memory') && <Line yAxisId="auto" type="monotone" dataKey="memory" stroke="#a855f7" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
            {activeMetrics.has('waits') && <Line yAxisId="auto" type="monotone" dataKey="waits" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
            {activeMetrics.has('disk_io') && <Line yAxisId="auto" type="monotone" dataKey="disk_io" stroke="#10b981" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>

        {/* Selected window indicator — persistent until Reset */}
        {winOv && winOv.width > 0 && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none border-x"
            style={{
              left: winOv.left,
              width: winOv.width,
              backgroundColor: dark ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.08)',
              borderColor: dark ? 'rgba(59,130,246,0.4)' : 'rgba(59,130,246,0.3)',
            }}
            data-testid="window-overlay"
          />
        )}

        {/* Drag overlay — only visible while mouse button is held */}
        {dragOv && dragOv.width > 4 && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: dragOv.left,
              width: dragOv.width,
              backgroundColor: dark ? 'rgba(245,158,11,0.25)' : 'rgba(245,158,11,0.2)',
            }}
            data-testid="drag-overlay"
          />
        )}
      </div>

      {/* Window info */}
      {window && (
        <div className="mt-1 text-[10px] text-blue-500 dark:text-blue-400 text-right">
          {new Date(window.from).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(window.to).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
}
