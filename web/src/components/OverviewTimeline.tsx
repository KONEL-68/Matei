import { useState, useCallback } from 'react';
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

const METRICS = [
  { key: 'cpu', label: 'CPU', color: '#3b82f6', dotClass: 'bg-blue-500' },
  { key: 'memory', label: 'Memory', color: '#a855f7', dotClass: 'bg-purple-500' },
  { key: 'waits', label: 'Waits', color: '#f59e0b', dotClass: 'bg-amber-500' },
  { key: 'disk_io', label: 'Disk I/O', color: '#10b981', dotClass: 'bg-emerald-500' },
] as const;

export function OverviewTimeline({ instanceId, window, onWindowChange }: OverviewTimelineProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const [overviewRange, setOverviewRange] = useState<OverviewRange>('24h');
  const [activeMetrics, setActiveMetrics] = useState<Set<string>>(new Set(['cpu', 'memory', 'waits', 'disk_io']));

  // Drag selection state — using useState so re-renders show the ReferenceArea
  const [selecting, setSelecting] = useState(false);
  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);

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
      setSelecting(true);
      setRefAreaLeft(e.activeLabel);
      setRefAreaRight(e.activeLabel);
    }
  }, []);

  const handleMouseMove = useCallback((e: { activeLabel?: string }) => {
    if (selecting && e.activeLabel) {
      setRefAreaRight(e.activeLabel);
    }
  }, [selecting]);

  const handleMouseUp = useCallback(() => {
    if (selecting && refAreaLeft && refAreaRight) {
      const t1 = new Date(refAreaLeft).getTime();
      const t2 = new Date(refAreaRight).getTime();
      const from = t1 < t2 ? refAreaLeft : refAreaRight;
      const to = t1 < t2 ? refAreaRight : refAreaLeft;
      if (from !== to) {
        onWindowChange({ from, to });
      }
    }
    setSelecting(false);
    setRefAreaLeft(null);
    setRefAreaRight(null);
  }, [selecting, refAreaLeft, refAreaRight, onWindowChange]);

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

      {/* Chart */}
      <ResponsiveContainer width="100%" height={120}>
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
          {activeMetrics.has('cpu') && <Line type="monotone" dataKey="cpu" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls />}
          {activeMetrics.has('memory') && <Line type="monotone" dataKey="memory" stroke="#a855f7" strokeWidth={1.5} dot={false} connectNulls />}
          {activeMetrics.has('waits') && <Line type="monotone" dataKey="waits" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls />}
          {activeMetrics.has('disk_io') && <Line type="monotone" dataKey="disk_io" stroke="#10b981" strokeWidth={1.5} dot={false} connectNulls />}
          {/* Current window highlight */}
          {window && (
            <ReferenceArea x1={window.from} x2={window.to} fill={dark ? '#3b82f640' : '#3b82f620'} />
          )}
          {/* Drag selection highlight */}
          {selecting && refAreaLeft && refAreaRight && (
            <ReferenceArea x1={refAreaLeft} x2={refAreaRight} fill={dark ? '#f59e0b40' : '#f59e0b30'} />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Window info */}
      {window && (
        <div className="mt-1 text-[10px] text-blue-500 dark:text-blue-400 text-right">
          {new Date(window.from).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(window.to).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
}
