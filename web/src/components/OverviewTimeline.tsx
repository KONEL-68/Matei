import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { useTheme } from '@/lib/theme';
import { authFetch } from '@/lib/auth';
import { insertGapBreaks as insertGapBreaksGeneric, fillAllNulls as fillAllNullsGeneric } from '@/lib/chart-utils';

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

const UNITS: Record<string, string> = {
  cpu: '%',
  memory: ' GB',
  waits: ' ms/s',
  disk_io: ' MB/s',
};

const TOOLTIP_METRICS = [
  { key: 'cpu', label: 'CPU', color: '#3b82f6' },
  { key: 'memory', label: 'Memory', color: '#a855f7' },
  { key: 'waits', label: 'Waits', color: '#f59e0b' },
  { key: 'disk_io', label: 'Disk I/O', color: '#10b981' },
];

/** Fill all sparse nulls via forward-fill then backward-fill so no natural nulls remain. */
function fillAllNulls(data: ChartPoint[]): ChartPoint[] {
  return fillAllNullsGeneric(data, ['cpu', 'memory', 'waits', 'disk_io']);
}

/**
 * Insert null-valued points at large time gaps so Recharts breaks the line.
 * Only triggers for gaps that indicate the backend was offline (not normal
 * collection jitter). Uses 10x the median interval as threshold.
 */
function insertGapBreaks(data: ChartPoint[]): ChartPoint[] {
  return insertGapBreaksGeneric(data, 'bucket');
}

const METRICS = [
  { key: 'cpu', label: 'CPU', color: '#3b82f6', dotClass: 'bg-blue-500' },
  { key: 'memory', label: 'Memory', color: '#a855f7', dotClass: 'bg-purple-500' },
  { key: 'waits', label: 'Waits', color: '#f59e0b', dotClass: 'bg-amber-500' },
  { key: 'disk_io', label: 'Disk I/O', color: '#10b981', dotClass: 'bg-emerald-500' },
] as const;

const CHART_MARGIN = { left: 0, right: 0, top: 4, bottom: 0 };
const CHART_PADDING_LEFT = 5;
const CHART_PADDING_RIGHT = 5;
const HANDLE_ZONE = 8;
const XAXIS_HEIGHT = 18;

type DragMode = 'create' | 'move' | 'resize-left' | 'resize-right';

interface DragState {
  mode: DragMode;
  startClientX: number;
  startFromTs: number;
  startToTs: number;
  startLocalX: number;
  currentLocalX: number;
}

export function OverviewTimeline({ instanceId, window, onWindowChange }: OverviewTimelineProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const [overviewRange, setOverviewRange] = useState<OverviewRange>('24h');
  const [activeMetrics, setActiveMetrics] = useState<Set<string>>(new Set(['cpu', 'memory', 'waits', 'disk_io']));
  const [autoRefresh, setAutoRefresh] = useState(true);

  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const windowRef = useRef(window);
  windowRef.current = window;
  const onWindowChangeRef = useRef(onWindowChange);
  onWindowChangeRef.current = onWindowChange;

  const { data: rawData = [] } = useQuery<RawPoint[]>({
    queryKey: ['overview-chart', instanceId, overviewRange],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/overview-chart?range=${overviewRange}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: autoRefresh ? 30_000 : false,
  });

  const mapped: ChartPoint[] = rawData.map(pt => ({
    bucket: pt.bucket,
    ts: new Date(pt.bucket).getTime(),
    cpu: pt.cpu_pct,
    memory: pt.memory_gb,
    waits: pt.waits_ms_per_sec,
    disk_io: pt.disk_io_mb_per_sec,
  }));
  const chartData: ChartPoint[] = insertGapBreaks(fillAllNulls(mapped));

  const chartDataRef = useRef(chartData);
  chartDataRef.current = chartData;

  const rangeMs = { '1h': 3600_000, '6h': 6 * 3600_000, '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000 }[overviewRange];
  const maxTs = Date.now();
  const minTs = maxTs - rangeMs;

  // Generate evenly spaced ticks across the full time range
  const tickInterval = { '1h': 5 * 60_000, '6h': 30 * 60_000, '24h': 60 * 60_000, '7d': 12 * 3600_000 }[overviewRange];
  const axisTicks: number[] = [];
  const firstTick = Math.ceil(minTs / tickInterval) * tickInterval;
  for (let t = firstTick; t <= maxTs; t += tickInterval) axisTicks.push(t);

  const getPlotBounds = useCallback(() => {
    const el = chartWrapRef.current;
    if (!el) return { plotLeft: 0, plotRight: 0, plotWidth: 1 };
    const rect = el.getBoundingClientRect();
    const plotLeft = CHART_PADDING_LEFT;
    const plotRight = rect.width - CHART_PADDING_RIGHT;
    const plotWidth = Math.max(1, plotRight - plotLeft);
    return { plotLeft, plotRight, plotWidth };
  }, []);

  const tsToPixel = useCallback((ts: number): number => {
    const { plotLeft, plotWidth } = getPlotBounds();
    if (maxTs === minTs) return plotLeft;
    const pct = Math.max(0, Math.min(1, (ts - minTs) / (maxTs - minTs)));
    return plotLeft + pct * plotWidth;
  }, [getPlotBounds, minTs, maxTs]);

  const windowFromTs = window ? new Date(window.from).getTime() : null;
  const windowToTs = window ? new Date(window.to).getTime() : null;
  const winLeftPx = windowFromTs != null ? tsToPixel(windowFromTs) : null;
  const winRightPx = windowToTs != null ? tsToPixel(windowToTs) : null;

  const emitWindow = useCallback((fromTs: number, toTs: number) => {
    const data = chartDataRef.current;
    if (data.length === 0) return;
    const mn = data[0].ts;
    const mx = data[data.length - 1].ts;
    const clampedFrom = Math.max(mn, Math.min(mx, fromTs));
    const clampedTo = Math.max(mn, Math.min(mx, toTs));
    const actualFrom = Math.min(clampedFrom, clampedTo);
    const actualTo = Math.max(clampedFrom, clampedTo);
    if (actualTo - actualFrom < 1000) return;
    onWindowChangeRef.current({
      from: new Date(actualFrom).toISOString(),
      to: new Date(actualTo).toISOString(),
    });
  }, []);

  // Document-level mousemove/mouseup during drag
  const dragRef = useRef(drag);
  dragRef.current = drag;

  useEffect(() => {
    if (!drag) return;

    const dragCursor = drag.mode === 'move' ? 'grabbing' : drag.mode === 'create' ? 'crosshair' : 'ew-resize';
    document.body.style.cursor = dragCursor;
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const el = chartWrapRef.current;
      if (!el) return;

      if (d.mode === 'create') {
        const rect = el.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        setDrag(prev => prev ? { ...prev, currentLocalX: localX } : null);
        return;
      }

      const { plotWidth } = getPlotBounds();
      const data = chartDataRef.current;
      if (data.length === 0) return;
      const mn = data[0].ts;
      const mx = data[data.length - 1].ts;
      const deltaX = e.clientX - d.startClientX;
      const deltaPxToTs = (deltaX / plotWidth) * (mx - mn);

      if (d.mode === 'move') {
        emitWindow(d.startFromTs + deltaPxToTs, d.startToTs + deltaPxToTs);
      } else if (d.mode === 'resize-left') {
        emitWindow(d.startFromTs + deltaPxToTs, d.startToTs);
      } else if (d.mode === 'resize-right') {
        emitWindow(d.startFromTs, d.startToTs + deltaPxToTs);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) { setDrag(null); return; }

      if (d.mode === 'create') {
        const el = chartWrapRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          const finalLocalX = e.clientX - rect.left;
          const left = Math.min(d.startLocalX, finalLocalX);
          const right = Math.max(d.startLocalX, finalLocalX);
          if (right - left > 10) {
            const { plotLeft, plotWidth } = getPlotBounds();
            const data = chartDataRef.current;
            if (data.length > 0) {
              const mn = data[0].ts;
              const mx = data[data.length - 1].ts;
              const pctL = Math.max(0, Math.min(1, (left - plotLeft) / plotWidth));
              const pctR = Math.max(0, Math.min(1, (right - plotLeft) / plotWidth));
              emitWindow(mn + pctL * (mx - mn), mn + pctR * (mx - mn));
            }
          }
        }
      }
      setDrag(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [drag, getPlotBounds, emitWindow]);

  // mouseDown on wrapper — events bubble up from Recharts SVG
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (chartDataRef.current.length === 0) return;
    const el = chartWrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    if (localY > rect.height - XAXIS_HEIGHT) return;

    const win = windowRef.current;
    if (win) {
      const fromTs = new Date(win.from).getTime();
      const toTs = new Date(win.to).getTime();
      const leftPx = tsToPixel(fromTs);
      const rightPx = tsToPixel(toTs);
      const nearLeft = Math.abs(localX - leftPx) <= HANDLE_ZONE;
      const nearRight = Math.abs(localX - rightPx) <= HANDLE_ZONE;
      const inside = localX > leftPx + HANDLE_ZONE && localX < rightPx - HANDLE_ZONE;

      if (nearLeft) {
        setDrag({ mode: 'resize-left', startClientX: e.clientX, startFromTs: fromTs, startToTs: toTs, startLocalX: localX, currentLocalX: localX });
        e.preventDefault();
        return;
      }
      if (nearRight) {
        setDrag({ mode: 'resize-right', startClientX: e.clientX, startFromTs: fromTs, startToTs: toTs, startLocalX: localX, currentLocalX: localX });
        e.preventDefault();
        return;
      }
      if (inside) {
        setDrag({ mode: 'move', startClientX: e.clientX, startFromTs: fromTs, startToTs: toTs, startLocalX: localX, currentLocalX: localX });
        e.preventDefault();
        return;
      }
    }

    setDrag({ mode: 'create', startClientX: e.clientX, startFromTs: 0, startToTs: 0, startLocalX: localX, currentLocalX: localX });
    e.preventDefault();
  }, [tsToPixel]);

  // Cursor: track hover position and compute cursor style
  const [hoverCursor, setHoverCursor] = useState<string>('crosshair');

  const handleMouseMoveForCursor = useCallback((e: React.MouseEvent) => {
    if (drag) return;
    const el = chartWrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    if (localY > rect.height - XAXIS_HEIGHT) {
      setHoverCursor('default');
      return;
    }

    const win = windowRef.current;
    if (win) {
      const fromTs = new Date(win.from).getTime();
      const toTs = new Date(win.to).getTime();
      const leftPx = tsToPixel(fromTs);
      const rightPx = tsToPixel(toTs);

      if (Math.abs(localX - leftPx) <= HANDLE_ZONE || Math.abs(localX - rightPx) <= HANDLE_ZONE) {
        setHoverCursor('ew-resize');
        return;
      }
      if (localX > leftPx + HANDLE_ZONE && localX < rightPx - HANDLE_ZONE) {
        setHoverCursor('grab');
        return;
      }
    }
    setHoverCursor('crosshair');
  }, [drag, tsToPixel]);

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

  const createDragOv = drag && drag.mode === 'create' ? (() => {
    const left = Math.min(drag.startLocalX, drag.currentLocalX);
    const width = Math.abs(drag.currentLocalX - drag.startLocalX);
    return width > 4 ? { left, width } : null;
  })() : null;

  const activeCursor = drag
    ? (drag.mode === 'move' ? 'grabbing' : drag.mode === 'create' ? 'crosshair' : 'ew-resize')
    : hoverCursor;

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
          <button
            onClick={() => setAutoRefresh(prev => !prev)}
            title={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
            data-testid="auto-refresh-toggle"
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors flex items-center gap-1 ${
              autoRefresh
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
            }`}
          >
            {autoRefresh ? '⏸ Live' : '▶ Paused'}
          </button>
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

      {/* Chart — mouseDown on wrapper captures drag, Recharts handles tooltip natively */}
      {/* CSS forces cursor inheritance on all Recharts SVG children */}
      <style>{`[data-testid="chart-area"] * { cursor: inherit !important; }`}</style>
      <div
        ref={chartWrapRef}
        className="relative select-none"
        style={{ cursor: activeCursor }}
        data-testid="chart-area"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMoveForCursor}
      >
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData} margin={CHART_MARGIN}>
            <XAxis
              dataKey="ts"
              type="number"
              domain={[minTs, maxTs]}
              ticks={axisTicks}
              fontSize={10}
              tick={{ fill: dark ? '#6b7280' : '#9ca3af' }}
              tickFormatter={(v: number) => formatTime(new Date(v).toISOString())}
              height={XAXIS_HEIGHT}
            />
            <YAxis yAxisId="pct" domain={[0, 100]} hide />
            <YAxis yAxisId="memory" hide />
            <YAxis yAxisId="waits" hide />
            <YAxis yAxisId="disk_io" hide />
            <Tooltip
              wrapperStyle={{ zIndex: 20 }}
              content={({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                if (!active || !payload?.length) return null;
                const pt = payload[0]?.payload as ChartPoint | undefined;
                if (!pt) return null;
                return (
                  <div className="rounded border border-gray-700 bg-gray-900 p-2 text-xs shadow-lg">
                    <p className="mb-1 text-gray-400">{pt.bucket ? formatTime(pt.bucket) : ''}</p>
                    {TOOLTIP_METRICS.map(({ key, label: lbl, color }) => {
                      const val = pt[key as keyof ChartPoint] as number | null;
                      const unit = UNITS[key] ?? '';
                      return (
                        <div key={key} className="flex items-center gap-2">
                          <span style={{ color }}>&#9632;</span>
                          <span className="text-gray-300">{lbl}</span>
                          <span className="ml-auto font-mono text-white pl-3">
                            {val != null ? `${Number(val).toFixed(1)}${unit}` : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            {activeMetrics.has('cpu') && <Line yAxisId="pct" type="linear" dataKey="cpu" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />}
            {activeMetrics.has('memory') && <Line yAxisId="memory" type="linear" dataKey="memory" stroke="#a855f7" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />}
            {activeMetrics.has('waits') && <Line yAxisId="waits" type="linear" dataKey="waits" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />}
            {activeMetrics.has('disk_io') && <Line yAxisId="disk_io" type="linear" dataKey="disk_io" stroke="#10b981" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>

        {/* Visual-only overlay for selection highlight + drag preview (pointerEvents: none) */}
        <div
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }}
          data-testid="selection-overlay"
        >
          {winLeftPx != null && winRightPx != null && (
            <>
              {/* Left dimmed area */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: XAXIS_HEIGHT,
                  left: 0,
                  width: Math.max(0, winLeftPx),
                  background: dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.1)',
                }}
                data-testid="dim-left"
              />
              {/* Right dimmed area */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: XAXIS_HEIGHT,
                  right: 0,
                  left: winRightPx,
                  background: dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.1)',
                }}
                data-testid="dim-right"
              />
              {/* Left edge line */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: XAXIS_HEIGHT,
                  left: winLeftPx - 1,
                  width: 2,
                  background: '#3b82f6',
                }}
                data-testid="window-highlight"
              />
              {/* Right edge line */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: XAXIS_HEIGHT,
                  left: winRightPx - 1,
                  width: 2,
                  background: '#3b82f6',
                }}
              />
            </>
          )}

          {/* Create-drag preview */}
          {createDragOv && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: XAXIS_HEIGHT,
                left: createDragOv.left,
                width: createDragOv.width,
                background: dark ? 'rgba(59,130,246,0.25)' : 'rgba(59,130,246,0.15)',
                borderLeft: '2px solid #3b82f6',
                borderRight: '2px solid #3b82f6',
              }}
              data-testid="drag-overlay"
            />
          )}
        </div>
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
