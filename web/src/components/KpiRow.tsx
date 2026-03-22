import { LineChart, Line, ResponsiveContainer } from 'recharts';

interface KpiProps {
  label: string;
  value: string;
  severity: 'ok' | 'warning' | 'critical';
  sparkData?: number[];
}

const bgColors = {
  ok: 'bg-emerald-600',
  warning: 'bg-yellow-500',
  critical: 'bg-red-600',
};

const lineColors = {
  ok: '#6ee7b7',
  warning: '#fde68a',
  critical: '#fca5a5',
};

function Kpi({ label, value, severity, sparkData }: KpiProps) {
  const chartData = sparkData?.slice(-30).map((v, i) => ({ i, v })) ?? [];

  return (
    <div className={`rounded-lg px-3 py-2 ${bgColors[severity]} text-white flex items-center gap-2 min-w-0`}>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide opacity-80 truncate">{label}</div>
        <div className="text-lg font-bold leading-tight truncate">{value}</div>
      </div>
      {chartData.length > 2 && (
        <div className="w-16 h-7 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <Line type="monotone" dataKey="v" stroke={lineColors[severity]} strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

interface KpiRowProps {
  cpuData: Array<{ sql_cpu_pct: number }>;
  waitsData: Array<{ wait_type: string; wait_ms_per_sec: number }>;
  sessionsData: Array<{ blocking_session_id: number | null; request_status: string }>;
  fileIoData: Array<{ avg_read_latency_ms: number; avg_write_latency_ms: number }>;
}

function severity(value: number, warnThreshold: number, critThreshold: number): 'ok' | 'warning' | 'critical' {
  if (value >= critThreshold) return 'critical';
  if (value >= warnThreshold) return 'warning';
  return 'ok';
}

export function KpiRow({ cpuData, waitsData, sessionsData, fileIoData }: KpiRowProps) {
  // SQL CPU
  const latestCpu = cpuData.length > 0 ? cpuData[cpuData.length - 1].sql_cpu_pct : 0;
  const cpuSpark = cpuData.map((d) => d.sql_cpu_pct);

  // Top wait
  const topWait = waitsData.length > 0
    ? waitsData.reduce((a, b) => a.wait_ms_per_sec > b.wait_ms_per_sec ? a : b)
    : null;

  // Blocked sessions
  const blockedCount = sessionsData.filter((s) => s.blocking_session_id && s.blocking_session_id > 0).length;

  // Pending requests
  const pendingCount = sessionsData.filter((s) => s.request_status === 'runnable').length;

  // IO latency
  const avgReadLatency = fileIoData.length > 0
    ? fileIoData.reduce((sum, f) => sum + f.avg_read_latency_ms, 0) / fileIoData.length
    : 0;
  const avgWriteLatency = fileIoData.length > 0
    ? fileIoData.reduce((sum, f) => sum + f.avg_write_latency_ms, 0) / fileIoData.length
    : 0;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="kpi-row">
      <Kpi
        label="SQL CPU"
        value={`${latestCpu}%`}
        severity={severity(latestCpu, 75, 90)}
        sparkData={cpuSpark}
      />
      <Kpi
        label="Top Wait"
        value={topWait ? `${topWait.wait_type}` : '-'}
        severity={topWait && topWait.wait_ms_per_sec > 10 ? 'warning' : 'ok'}
      />
      <Kpi
        label="Blocked"
        value={String(blockedCount)}
        severity={severity(blockedCount, 1, 5)}
      />
      <Kpi
        label="Pending"
        value={String(pendingCount)}
        severity={severity(pendingCount, 5, 20)}
      />
      <Kpi
        label="Read IO"
        value={`${avgReadLatency.toFixed(1)}ms`}
        severity={severity(avgReadLatency, 20, 50)}
      />
      <Kpi
        label="Write IO"
        value={`${avgWriteLatency.toFixed(1)}ms`}
        severity={severity(avgWriteLatency, 20, 50)}
      />
    </div>
  );
}
