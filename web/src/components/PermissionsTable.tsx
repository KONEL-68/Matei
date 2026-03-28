import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';
import { CollapsibleSection } from '@/components/CollapsibleSection';

// ── Types ──

interface PermissionsMember {
  login_name: string;
  login_type: string;
}

interface PermissionsRole {
  role_name: string;
  windows_logins: number;
  ad_accounts: number;
  sql_logins: number;
  members: PermissionsMember[];
}

interface PermissionsData {
  collected_at: string | null;
  roles: PermissionsRole[];
}

interface PermissionsTableProps {
  instanceId: string;
}

// ── Helpers ──

function formatSampledAt(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const mon = d.toLocaleString('en-US', { month: 'short' });
  const year = d.getFullYear();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${day} ${mon} ${year} ${time}`;
}

// ── Component ──

export function PermissionsTable({ instanceId }: PermissionsTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<PermissionsData | null>({
    queryKey: ['permissions', instanceId],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/permissions`);
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 300_000,
  });

  const toggleRole = (roleName: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(roleName)) {
        next.delete(roleName);
      } else {
        next.add(roleName);
      }
      return next;
    });
  };

  return (
    <CollapsibleSection title="Permissions" defaultOpen>
      <div data-testid="permissions-table">
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-500 dark:text-gray-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
            Loading...
          </div>
        ) : !data || !data.collected_at || data.roles.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No data available</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
              Permissions sampled at {formatSampledAt(data.collected_at)}
            </p>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
                  <th className="py-2 pl-2 pr-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Access</th>
                  <th className="py-2 pr-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Windows logins</th>
                  <th className="py-2 pr-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Active Directory accounts</th>
                  <th className="py-2 pr-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">SQL logins</th>
                </tr>
              </thead>
              <tbody>
                {data.roles
                  .filter(role => (role.windows_logins + role.ad_accounts + role.sql_logins) > 0)
                  .map((role) => {
                  const isExpanded = expanded.has(role.role_name);
                  return (
                    <PermissionsRow
                      key={role.role_name}
                      role={role}
                      isExpanded={isExpanded}
                      onToggle={() => toggleRole(role.role_name)}
                    />
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </CollapsibleSection>
  );
}

// ── Row sub-component ──

function PermissionsRow({ role, isExpanded, onToggle }: {
  role: PermissionsRole;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50"
        onClick={onToggle}
        data-testid={`role-row-${role.role_name}`}
      >
        <td className="py-2 pl-2 pr-3 text-xs text-gray-900 dark:text-gray-100">
          <span className="mr-2 inline-block w-3 text-gray-400">{isExpanded ? '\u25BC' : '\u25B6'}</span>
          <span className="font-medium">{role.role_name}</span>
        </td>
        <td className="py-2 pr-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300">
          {role.windows_logins}
        </td>
        <td className="py-2 pr-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300">
          {role.ad_accounts}
        </td>
        <td className="py-2 pr-2 text-right text-xs font-medium text-gray-700 dark:text-gray-300">
          {role.sql_logins}
        </td>
      </tr>
      {isExpanded && role.members.length > 0 && (
        <tr>
          <td colSpan={4} className="bg-gray-50 px-2 py-2 dark:bg-gray-800/30">
            <div className="ml-7">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className="pb-1 text-[10px] font-semibold uppercase text-gray-400 dark:text-gray-500">Login Name</th>
                    <th className="pb-1 text-[10px] font-semibold uppercase text-gray-400 dark:text-gray-500">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {role.members.map((m) => (
                    <tr key={m.login_name}>
                      <td className="py-0.5 font-mono text-[11px] text-gray-700 dark:text-gray-300">{m.login_name}</td>
                      <td className="py-0.5 text-[11px] text-gray-500 dark:text-gray-400">{m.login_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
      {isExpanded && role.members.length === 0 && (
        <tr>
          <td colSpan={4} className="bg-gray-50 px-2 py-2 dark:bg-gray-800/30">
            <div className="ml-7 text-[11px] text-gray-400 dark:text-gray-500">No members</div>
          </td>
        </tr>
      )}
    </>
  );
}
