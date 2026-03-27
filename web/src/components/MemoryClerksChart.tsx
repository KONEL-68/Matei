import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useTheme } from '@/lib/theme';
import { authFetch } from '@/lib/auth';

// ── Types ──

interface MemoryClerksChartProps {
  instanceId: string;
  rangeParams: string;
}

interface ClerkRow {
  bucket: string;
  clerk_type: string;
  size_mb: number;
}

// ── Helpers ──

const CLERK_COLORS = [
  '#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#06b6d4', '#e11d48', '#a855f7', '#22c55e', '#eab308',
];

const FRIENDLY_NAMES: Record<string, string> = {
  MEMORYCLERK_SQLBUFFERPOOL: 'Buffer Pool',
  MEMORYCLERK_SQLQUERYPLAN: 'Query Plans',
  MEMORYCLERK_SQLOPTIMIZER: 'Optimizer',
  MEMORYCLERK_SQLCLR: 'CLR',
  MEMORYCLERK_SQLGENERAL: 'General',
  MEMORYCLERK_SQLLOGPOOL: 'Log Pool',
  MEMORYCLERK_SQLSTORENG: 'Storage Engine',
  MEMORYCLERK_SQLTRACE: 'Trace',
  MEMORYCLERK_SQLCONNECTIONPOOL: 'Connection Pool',
  MEMORYCLERK_SQLHTTP: 'HTTP',
  MEMORYCLERK_SQLSOAP: 'SOAP',
  MEMORYCLERK_SQLXP: 'Extended Procs',
  MEMORYCLERK_SQLUTILITIES: 'Utilities',
  MEMORYCLERK_SOSNODE: 'SOS Node',
  MEMORYCLERK_SQLSERVICEBROKER: 'Service Broker',
  MEMORYCLERK_SNI: 'SNI (Network)',
  MEMORYCLERK_XE: 'Extended Events',
  MEMORYCLERK_HOST: 'Host',
  MEMORYCLERK_XTP: 'In-Memory OLTP',
  CACHESTORE_SQLCP: 'SQL Plan Cache',
  CACHESTORE_OBJCP: 'Object Plan Cache',
  CACHESTORE_PHDR: 'Parse Header Cache',
  CACHESTORE_TEMPTABLES: 'Temp Tables Cache',
  CACHESTORE_COLUMNSTOREOBJECTPOOL: 'Columnstore Pool',
  OBJECTSTORE_LOCK_MANAGER: 'Lock Manager',
  OBJECTSTORE_SNI_PROV: 'SNI Provider',
  USERSTORE_TOKENPERM: 'Token Permissions',
  USERSTORE_DBMETADATA: 'DB Metadata',
  USERSTORE_SCHEMAMGR: 'Schema Manager',
};

function friendlyName(type: string): string {
  if (FRIENDLY_NAMES[type]) return FRIENDLY_NAMES[type];
  // Fallback: strip prefix and title-case
  return type
    .replace(/^MEMORYCLERK_/, '')
    .replace(/^CACHESTORE_/, '')
    .replace(/^OBJECTSTORE_/, '')
    .replace(/^USERSTORE_/, '');
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatMb(value: number): string {
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${Math.round(value)} MB`;
}

// ── Tooltip ──

function ClerkTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const visible = [...payload.filter(p => p.value != null && p.value > 0)]
    .sort((a, b) => b.value - a.value);
  return (
    <div className="rounded border border-gray-700 bg-gray-900 p-2 text-xs shadow-lg max-h-64 overflow-y-auto">
      <p className="mb-1 text-gray-400">{label ? formatTime(label) : ''}</p>
      {visible.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-300">{p.dataKey}</span>
          <span className="ml-auto font-mono text-white">{formatMb(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Component ──

export function MemoryClerksChart({ instanceId, rangeParams }: MemoryClerksChartProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const [hiddenClerks, setHiddenClerks] = useState<Set<string>>(new Set());

  const { data: rawData = [] } = useQuery<ClerkRow[]>({
    queryKey: ['memory-clerks-chart', instanceId, rangeParams],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/memory-clerks?${rangeParams}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
  });

  if (rawData.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900" data-testid="memory-clerks-chart">
        <h4 className="mb-3 text-xs font-semibold text-gray-900 dark:text-gray-100">Memory Clerks (MB)</h4>
        <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">No data</p>
      </div>
    );
  }

  // Pivot: group by bucket, each clerk_type becomes a key
  const clerkTypes = [...new Set(rawData.map(d => friendlyName(d.clerk_type)))];
  const bucketMap = new Map<string, Record<string, number | string>>();
  for (const pt of rawData) {
    if (!bucketMap.has(pt.bucket)) {
      bucketMap.set(pt.bucket, { bucket: pt.bucket });
    }
    bucketMap.get(pt.bucket)![friendlyName(pt.clerk_type)] = Math.round(pt.size_mb);
  }

  const chartData = [...bucketMap.values()].sort((a, b) =>
    new Date(a.bucket as string).getTime() - new Date(b.bucket as string).getTime()
  );

  const toggleClerk = (dataKey: string) => {
    setHiddenClerks(prev => {
      const next = new Set(prev);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900" data-testid="memory-clerks-chart">
      <h4 className="mb-3 text-xs font-semibold text-gray-900 dark:text-gray-100">Memory Clerks (MB)</h4>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#f0f0f0'} />
          <XAxis dataKey="bucket" fontSize={10} tick={{ fill: dark ? '#6b7280' : '#9ca3af' }} tickFormatter={formatTime} />
          <YAxis fontSize={10} tick={{ fill: dark ? '#6b7280' : '#9ca3af' }} width={50} tickFormatter={(v: number) => formatMb(v)} />
          <Tooltip content={<ClerkTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 10, cursor: 'pointer' }}
            onClick={(e: any) => toggleClerk(e.dataKey)} // eslint-disable-line @typescript-eslint/no-explicit-any
            formatter={(value: string) => (
              <span style={{ color: hiddenClerks.has(value) ? '#6b7280' : undefined, textDecoration: hiddenClerks.has(value) ? 'line-through' : undefined }}>
                {value}
              </span>
            )}
          />
          {clerkTypes.map((ct, i) => (
            <Bar
              key={ct}
              dataKey={ct}
              stackId="a"
              fill={CLERK_COLORS[i % CLERK_COLORS.length]}
              hide={hiddenClerks.has(ct)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
