import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '@/lib/auth';

export interface OverviewInstance {
  id: number;
  name: string;
  host: string;
  port: number;
  status: string;
  last_seen: string | null;
  group_id: number | null;
  group_name: string | null;
  cpu: { sql_cpu_pct: number; other_process_cpu_pct: number; system_idle_pct: number } | null;
  memory: { os_total_memory_mb: number; os_available_memory_mb: number; sql_committed_mb: number; sql_target_mb: number } | null;
  health: { version: string; edition: string; uptime_seconds: number } | null;
  top_waits: Array<{ wait_type: string; wait_ms_per_sec: number }>;
  total_wait_ms_per_sec: number | null;
  disk_io_mb_per_sec: number | null;
  alert_count: number;
  first_alert_message: string | null;
  healthy_since: string | null;
}

function statusDotColor(status: string) {
  const colors: Record<string, string> = {
    online: 'bg-emerald-500',
    unreachable: 'bg-red-500',
    unknown: 'bg-gray-400',
  };
  return colors[status] ?? colors.unknown;
}

function formatWaits(v: number | null): string {
  if (v == null) return '\u2014';
  if (v >= 1000) return `${(v / 1000).toFixed(1)}s/s`;
  return `${Math.round(v)}ms/s`;
}

function formatDiskIo(v: number | null): string {
  if (v == null) return '\u2014';
  return `${v.toFixed(1)} MB/s`;
}

function formatHealthySince(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function waitSeverityColor(v: number | null): string {
  if (v == null) return 'text-gray-400 dark:text-gray-500';
  if (v > 500) return 'text-red-600 dark:text-red-400';
  if (v >= 100) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

function cpuSeverityColor(v: number | null): string {
  if (v == null) return 'text-gray-400 dark:text-gray-500';
  if (v >= 90) return 'text-red-600 dark:text-red-400';
  if (v >= 75) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

interface MenuProps {
  instanceId: number;
  instanceName: string;
  isEnabled?: boolean;
  onRefresh: () => void;
}

function CardMenu({ instanceId, instanceName, isEnabled = true, onRefresh }: MenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleDisable() {
    setOpen(false);
    await authFetch(`/api/instances/${instanceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_enabled: !isEnabled }),
    });
    onRefresh();
  }

  async function handleDelete() {
    setOpen(false);
    if (!confirm(`Delete instance "${instanceName}"?`)) return;
    await authFetch(`/api/instances/${instanceId}`, { method: 'DELETE' });
    onRefresh();
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        data-testid={`menu-btn-${instanceId}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute right-0 top-6 z-20 w-36 rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
          data-testid={`menu-${instanceId}`}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false); navigate(`/instances/${instanceId}/edit`); }}
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            Edit
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDisable(); }}
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            {isEnabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(); }}
            className="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 dark:text-red-400"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function InstanceCard({ inst, onRefresh }: { inst: OverviewInstance; onRefresh: () => void }) {
  const navigate = useNavigate();

  const subtitle = inst.health
    ? `SQL Server \u00b7 ${inst.health.edition?.split(' ')[0] ?? ''} \u00b7 v${inst.health.version}`
    : inst.status === 'unreachable' ? 'Unreachable' : 'Connecting...';

  const hasAlerts = inst.alert_count > 0;

  return (
    <div
      onClick={() => navigate(`/instances/${inst.id}`)}
      className="cursor-pointer rounded-lg border border-gray-200 bg-white transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 flex flex-col"
      data-testid={`instance-card-${inst.id}`}
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${statusDotColor(inst.status)}`} data-testid="status-dot" />
            <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{inst.name}</span>
          </div>
          <CardMenu instanceId={inst.id} instanceName={inst.name} onRefresh={onRefresh} />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{subtitle}</p>
      </div>

      {/* KPIs */}
      <div className="px-4 py-2 grid grid-cols-3 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Waits</div>
          <div className={`text-sm font-semibold ${waitSeverityColor(inst.total_wait_ms_per_sec)}`} data-testid="kpi-waits">
            {formatWaits(inst.total_wait_ms_per_sec)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">CPU</div>
          <div className={`text-sm font-semibold ${cpuSeverityColor(inst.cpu?.sql_cpu_pct ?? null)}`} data-testid="kpi-cpu">
            {inst.cpu ? `${inst.cpu.sql_cpu_pct}%` : '\u2014'}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Disk I/O</div>
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-300" data-testid="kpi-disk-io">
            {formatDiskIo(inst.disk_io_mb_per_sec)}
          </div>
        </div>
      </div>

      {/* Status bar at bottom */}
      <div className={`mt-auto rounded-b-lg px-4 py-1.5 text-xs ${
        hasAlerts
          ? inst.alert_count > 0 && inst.first_alert_message?.toLowerCase().includes('critical')
            ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
            : 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300'
          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
      }`} data-testid="card-status-bar">
        {hasAlerts ? (
          <span className="truncate block">
            {inst.first_alert_message}
            {inst.alert_count > 1 && <span className="ml-1 opacity-75">+{inst.alert_count - 1} more</span>}
          </span>
        ) : (
          <span>Healthy{inst.healthy_since ? ` since ${formatHealthySince(inst.healthy_since)}` : ''}</span>
        )}
      </div>
    </div>
  );
}
