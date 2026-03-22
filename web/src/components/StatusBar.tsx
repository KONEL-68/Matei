interface PerfCounterLatest {
  counter_name: string;
  cntr_value: number;
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
}

export interface StatusBarProps {
  cpuData: CpuRow[];
  waitsData: WaitRow[];
  sessionsData: SessionRow[];
  fileIoData: FileIoRow[];
  perfCounters?: { latest: PerfCounterLatest[] };
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

export function StatusBar({ cpuData, waitsData, sessionsData, fileIoData, perfCounters }: StatusBarProps) {
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

  // Average read/write latency across all files
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

  return (
    <div
      className="flex items-center gap-4 flex-wrap rounded border px-3 py-1.5 text-xs bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-700 text-gray-700 dark:text-gray-300"
      data-testid="status-bar"
    >
      <span className="inline-flex items-center gap-1.5">
        <Dot severity={cpuSev} />CPU {latestCpu != null ? `${latestCpu}%` : '\u2014'}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot severity={topWaitSev} />
        Top Wait: {topWait ? `${topWait.wait_type} ${topWait.wait_ms_per_sec.toFixed(0)}ms/s` : '\u2014'}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot severity={blockedSev} />Blocked {blockedCount}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot severity={pendingSev} />Pending {pending != null ? pending : '\u2014'}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot severity={readSev} />Read IO {avgRead != null ? `${avgRead.toFixed(1)}ms` : '\u2014'}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot severity={writeSev} />Write IO {avgWrite != null ? `${avgWrite.toFixed(1)}ms` : '\u2014'}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot severity={pleSev} />PLE {formatPle(ple)}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot severity={memGrantsSev} />Mem Grants Pending {memGrants != null ? memGrants : '\u2014'}
      </span>
    </div>
  );
}
