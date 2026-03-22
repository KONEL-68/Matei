import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';

interface PerfCounterLatest {
  counter_name: string;
  cntr_value: number;
  collected_at?: string;
}

interface WaitRow {
  wait_type: string;
  wait_ms_per_sec: number;
}

interface SessionRow {
  blocking_session_id: number | null;
}

interface FileIoRow {
  avg_read_latency_ms: number;
  avg_write_latency_ms: number;
}

interface CpuRow {
  sql_cpu_pct: number;
  collected_at?: string;
}

interface HealthData {
  hadr_enabled: boolean;
}

export interface StatusBarProps {
  instanceId: string;
}

type Severity = 'green' | 'yellow' | 'red' | 'gray';

const dotClass: Record<Severity, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-yellow-400',
  red: 'bg-red-500',
  gray: 'bg-gray-500',
};

function sev(value: number | null, warn: number, crit: number): Severity {
  if (value == null) return 'gray';
  if (value >= crit) return 'red';
  if (value >= warn) return 'yellow';
  return 'green';
}

function sevInverse(value: number | null, warnBelow: number, critBelow: number): Severity {
  if (value == null) return 'gray';
  if (value < critBelow) return 'red';
  if (value < warnBelow) return 'yellow';
  return 'green';
}

function Dot({ severity }: { severity: Severity }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${dotClass[severity]}`} />;
}

function getCounter(counters: PerfCounterLatest[], name: string): number | null {
  const found = counters.find((c) => c.counter_name === name);
  return found != null ? found.cntr_value : null;
}

function formatPle(v: number | null): string {
  if (v == null) return '\u2014';
  if (v >= 3600) return `${(v / 3600).toFixed(1)}h`;
  return `${Math.round(v)}s`;
}

function formatRate(v: number | null): string {
  if (v == null) return '\u2014';
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

function formatBytes(v: number | null): string {
  if (v == null) return '\u2014';
  return `${(v / 1024 / 1024).toFixed(1)} MB/s`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.json();
}

const DIV = 'inline-flex items-center gap-1.5 border-l border-gray-300 dark:border-gray-600 pl-3';

export function StatusBar({ instanceId }: StatusBarProps) {
  const { data: cpuData = [] } = useQuery<CpuRow[]>({
    queryKey: ['statusbar-cpu', instanceId],
    queryFn: () => fetchJson(`/api/metrics/${instanceId}/cpu?range=1h`),
    refetchInterval: 15_000,
  });

  const { data: waitsData = [] } = useQuery<WaitRow[]>({
    queryKey: ['statusbar-waits', instanceId],
    queryFn: () => fetchJson(`/api/metrics/${instanceId}/waits?range=1h`),
    refetchInterval: 15_000,
  });

  const { data: sessionsData = [] } = useQuery<SessionRow[]>({
    queryKey: ['statusbar-sessions', instanceId],
    queryFn: () => fetchJson(`/api/metrics/${instanceId}/sessions`),
    refetchInterval: 15_000,
  });

  const { data: fileIoData = [] } = useQuery<FileIoRow[]>({
    queryKey: ['statusbar-fileio', instanceId],
    queryFn: () => fetchJson(`/api/metrics/${instanceId}/file-io?range=1h`),
    refetchInterval: 15_000,
  });

  const { data: perfCounters, dataUpdatedAt } = useQuery<{ latest: PerfCounterLatest[] }>({
    queryKey: ['statusbar-perf', instanceId],
    queryFn: () => fetchJson(`/api/metrics/${instanceId}/perf-counters?range=1h`),
    refetchInterval: 15_000,
  });

  const { data: health } = useQuery<HealthData>({
    queryKey: ['statusbar-health', instanceId],
    queryFn: () => fetchJson(`/api/metrics/${instanceId}/health`),
    refetchInterval: 60_000,
  });

  const latestCpu = cpuData.length > 0 ? cpuData[cpuData.length - 1].sql_cpu_pct : null;
  const cpuSev = sev(latestCpu, 75, 90);

  const topWait = waitsData.length > 0
    ? waitsData.reduce((a, b) => a.wait_ms_per_sec > b.wait_ms_per_sec ? a : b)
    : null;
  const topWaitSev = topWait ? sev(topWait.wait_ms_per_sec, 50, 200) : 'gray';

  const blockedCount = sessionsData.filter((s) => s.blocking_session_id && s.blocking_session_id > 0).length;
  const blockedSev = sev(blockedCount, 1, 5);

  const counters = perfCounters?.latest ?? [];
  const pending = getCounter(counters, 'Pending Tasks');
  const pendingSev = sev(pending, 5, 20);

  const avgRead = fileIoData.length > 0
    ? fileIoData.reduce((sum, f) => sum + f.avg_read_latency_ms, 0) / fileIoData.length
    : null;
  const avgWrite = fileIoData.length > 0
    ? fileIoData.reduce((sum, f) => sum + f.avg_write_latency_ms, 0) / fileIoData.length
    : null;
  const readSev = sev(avgRead, 20, 50);
  const writeSev = sev(avgWrite, 20, 50);

  const ple = getCounter(counters, 'Page life expectancy');
  const pleSev = sevInverse(ple, 1000, 300);

  const memGrants = getCounter(counters, 'Memory Grants Pending');
  const memGrantsSev = sev(memGrants, 1, 5);

  const batchReqs = getCounter(counters, 'Batch Requests/sec');

  const hadrEnabled = health?.hadr_enabled ?? false;
  const bytesSent = hadrEnabled ? getCounter(counters, 'Bytes Sent to Replica/sec') : null;
  const bytesRecv = hadrEnabled ? getCounter(counters, 'Bytes Received from Replica/sec') : null;

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '\u2014';

  return (
    <div
      className="flex items-center gap-4 flex-wrap rounded border px-3 py-1.5 text-xs bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-700 text-gray-700 dark:text-gray-300"
      data-testid="status-bar"
    >
      <span
        className="inline-flex items-center gap-1 text-gray-400 dark:text-gray-500"
        title={`Last updated: ${lastUpdated}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
        </svg>
        Live
      </span>
      <span className={DIV}>
        <Dot severity={cpuSev} />CPU {latestCpu != null ? `${latestCpu}%` : '\u2014'}
      </span>
      <span className={DIV}>
        <Dot severity={topWaitSev} />
        Top Wait: {topWait ? `${topWait.wait_type} ${topWait.wait_ms_per_sec.toFixed(0)}ms/s` : '\u2014'}
      </span>
      <span className={DIV}>
        <Dot severity={blockedSev} />Blocked {blockedCount}
      </span>
      <span className={DIV}>
        <Dot severity={pendingSev} />Pending {pending != null ? pending : '\u2014'}
      </span>
      <span className={DIV}>
        <Dot severity={readSev} />Read IO {avgRead != null ? `${avgRead.toFixed(1)}ms` : '\u2014'}
      </span>
      <span className={DIV}>
        <Dot severity={writeSev} />Write IO {avgWrite != null ? `${avgWrite.toFixed(1)}ms` : '\u2014'}
      </span>
      <span className={DIV}>
        <Dot severity={pleSev} />PLE {formatPle(ple)}
      </span>
      <span className={DIV}>
        <Dot severity={memGrantsSev} />Mem Grants Pending {memGrants != null ? memGrants : '\u2014'}
      </span>
      <span className={DIV}>
        <Dot severity="gray" />Batch Req/s {formatRate(batchReqs)}
      </span>
      {hadrEnabled && (
        <>
          <span className={DIV}>
            <Dot severity="gray" />Bytes Sent/s {formatBytes(bytesSent)}
          </span>
          <span className={DIV}>
            <Dot severity="gray" />Bytes Recv/s {formatBytes(bytesRecv)}
          </span>
        </>
      )}
    </div>
  );
}
