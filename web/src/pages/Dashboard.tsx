import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';
import { InstanceCard, type OverviewInstance } from '@/components/InstanceCard';

interface OverviewData {
  total: number;
  online: number;
  offline: number;
  error: number;
  instances: OverviewInstance[];
}

async function fetchOverview(): Promise<OverviewData> {
  const res = await authFetch('/api/metrics/overview');
  if (!res.ok) throw new Error('Failed to fetch overview');
  return res.json();
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
    green: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800',
    gray: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
    red: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
  };
  const dotColors: Record<string, string> = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    gray: 'bg-gray-400',
    red: 'bg-red-500',
  };
  return (
    <div className={`rounded-lg border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${dotColors[color]}`} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  );
}

function MiniHealthBar({ instances }: { instances: OverviewInstance[] }) {
  const total = instances.length;
  if (total === 0) return null;
  const healthy = instances.filter(i => i.status === 'online' && i.alert_count === 0).length;
  const pct = Math.round((healthy / total) * 100);
  return (
    <div className="flex items-center gap-1.5 ml-2">
      <div className="h-1.5 w-16 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-gray-400 dark:text-gray-500">{pct}%</span>
    </div>
  );
}

function GroupSection({ title, instances, collapsed, onToggle, onRefresh }: {
  title: string;
  instances: OverviewInstance[];
  collapsed: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="mt-6" data-testid={`group-${title}`}>
      <button onClick={onToggle} className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 transition-transform ${collapsed ? '' : 'rotate-90'}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        {title}
        <span className="text-xs font-normal text-gray-400 dark:text-gray-500">({instances.length})</span>
        <MiniHealthBar instances={instances} />
      </button>
      {!collapsed && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {instances.map((inst) => (
            <InstanceCard key={inst.id} inst={inst} onRefresh={onRefresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 h-36">
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 w-24 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
            <div className="h-2 w-32 rounded bg-gray-100 dark:bg-gray-800" />
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div className="h-6 rounded bg-gray-100 dark:bg-gray-800" />
              <div className="h-6 rounded bg-gray-100 dark:bg-gray-800" />
              <div className="h-6 rounded bg-gray-100 dark:bg-gray-800" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const queryClient = useQueryClient();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const { data, isLoading, isError } = useQuery<OverviewData>({
    queryKey: ['metrics-overview'],
    queryFn: fetchOverview,
    refetchInterval: 15000,
  });

  const onRefresh = () => queryClient.invalidateQueries({ queryKey: ['metrics-overview'] });

  if (isLoading) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h2>
        <LoadingSkeleton />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h2>
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-8 text-center dark:border-red-800 dark:bg-red-950">
          <p className="text-red-700 dark:text-red-400">Failed to load dashboard data.</p>
          <p className="text-sm text-red-500 dark:text-red-500 mt-1">The API may be unavailable. Check that the backend is running.</p>
        </div>
      </div>
    );
  }

  if (data.total === 0) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h2>
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
          <p className="text-gray-500 dark:text-gray-400">No instances configured.</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            Add a SQL Server instance to start monitoring.
          </p>
        </div>
      </div>
    );
  }

  // Group instances
  const hasGroups = data.instances.some((i) => i.group_name);
  const groups = new Map<string, OverviewInstance[]>();
  const ungrouped: OverviewInstance[] = [];
  for (const inst of data.instances) {
    if (inst.group_name) {
      const arr = groups.get(inst.group_name) ?? [];
      arr.push(inst);
      groups.set(inst.group_name, arr);
    } else {
      ungrouped.push(inst);
    }
  }

  const toggleGroup = (name: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h2>

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-4 gap-4">
        <StatCard label="Total" value={data.total} color="blue" />
        <StatCard label="Online" value={data.online} color="green" />
        <StatCard label="Offline" value={data.offline} color="gray" />
        <StatCard label="Error" value={data.error} color="red" />
      </div>

      {/* Instance grid — grouped */}
      {!hasGroups ? (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.instances.map((inst) => (
            <InstanceCard key={inst.id} inst={inst} onRefresh={onRefresh} />
          ))}
        </div>
      ) : (
        <>
          {[...groups.entries()].map(([name, instances]) => (
            <GroupSection
              key={name}
              title={name}
              instances={instances}
              collapsed={collapsedGroups.has(name)}
              onToggle={() => toggleGroup(name)}
              onRefresh={onRefresh}
            />
          ))}
          {ungrouped.length > 0 && (
            <GroupSection
              title="Ungrouped"
              instances={ungrouped}
              collapsed={collapsedGroups.has('Ungrouped')}
              onToggle={() => toggleGroup('Ungrouped')}
              onRefresh={onRefresh}
            />
          )}
        </>
      )}
    </div>
  );
}
