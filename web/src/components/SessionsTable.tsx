interface SessionRow {
  session_id: number;
  request_id: number | null;
  blocking_session_id: number | null;
  session_status: string;
  request_status: string | null;
  login_name: string;
  host_name: string;
  program_name: string;
  database_name: string;
  command: string | null;
  wait_type: string | null;
  wait_time_ms: number | null;
  elapsed_time_ms: number | null;
  cpu_time_ms: number | null;
  logical_reads: number | null;
  writes: number | null;
  open_transaction_count: number | null;
  granted_memory_kb: number | null;
  current_statement: string | null;
}

interface SessionsTableProps {
  data: SessionRow[];
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function SessionsTable({ data }: SessionsTableProps) {
  // Collect all blocking session IDs to highlight blocked sessions
  const blockingIds = new Set(
    data.filter((s) => s.blocking_session_id && s.blocking_session_id > 0).map((s) => s.blocking_session_id),
  );
  const blockedIds = new Set(
    data.filter((s) => s.blocking_session_id && s.blocking_session_id > 0).map((s) => s.session_id),
  );

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Active Sessions</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">No active sessions</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
        Active Sessions
        <span className="ml-2 text-xs font-normal text-gray-500">({data.length})</span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            <tr>
              <th className="px-2 py-2">SPID</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Blocker</th>
              <th className="px-2 py-2">Database</th>
              <th className="px-2 py-2">Login</th>
              <th className="px-2 py-2">Host</th>
              <th className="px-2 py-2">Command</th>
              <th className="px-2 py-2">Wait</th>
              <th className="px-2 py-2 text-right">Elapsed</th>
              <th className="px-2 py-2 text-right">CPU</th>
              <th className="px-2 py-2 text-right">Reads</th>
              <th className="px-2 py-2">Statement</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800 dark:text-gray-300">
            {data.map((s, i) => {
              const isBlocker = blockingIds.has(s.session_id);
              const isBlocked = blockedIds.has(s.session_id);
              const rowClass = isBlocker
                ? 'bg-red-50 dark:bg-red-950'
                : isBlocked
                  ? 'bg-orange-50 dark:bg-orange-950'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800';

              return (
                <tr key={`${s.session_id}-${i}`} className={rowClass}>
                  <td className="px-2 py-1.5 font-medium">
                    {s.session_id}
                    {isBlocker && <span className="ml-1 text-red-600" title="Head blocker">!</span>}
                  </td>
                  <td className="px-2 py-1.5">{s.request_status ?? s.session_status}</td>
                  <td className="px-2 py-1.5">
                    {s.blocking_session_id && s.blocking_session_id > 0 ? (
                      <span className="font-medium text-red-600">{s.blocking_session_id}</span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-2 py-1.5">{s.database_name ?? '-'}</td>
                  <td className="px-2 py-1.5">{s.login_name}</td>
                  <td className="px-2 py-1.5 max-w-[100px] truncate" title={s.host_name}>{s.host_name ?? '-'}</td>
                  <td className="px-2 py-1.5">{s.command ?? '-'}</td>
                  <td className="px-2 py-1.5 font-mono">
                    {s.wait_type ? (
                      <span title={`${s.wait_time_ms}ms`}>{s.wait_type}</span>
                    ) : '-'}
                  </td>
                  <td className="px-2 py-1.5 text-right">{formatDuration(s.elapsed_time_ms)}</td>
                  <td className="px-2 py-1.5 text-right">{formatDuration(s.cpu_time_ms)}</td>
                  <td className="px-2 py-1.5 text-right">{s.logical_reads?.toLocaleString() ?? '-'}</td>
                  <td className="px-2 py-1.5 max-w-[200px] truncate font-mono" title={s.current_statement ?? ''}>
                    {s.current_statement ?? '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
