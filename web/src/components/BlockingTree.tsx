import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';

interface SessionNode {
  session_id: number;
  login_name: string;
  database_name: string;
  wait_type: string | null;
  wait_time_ms: number | null;
  elapsed_time_ms: number | null;
  current_statement: string | null;
  children: SessionNode[];
}

interface Props {
  instanceId: string;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function severityClass(waitMs: number | null): string {
  if (!waitMs) return '';
  const sec = waitMs / 1000;
  if (sec > 300) return 'border-l-red-500 bg-red-50 dark:bg-red-950/30';
  if (sec > 60) return 'border-l-yellow-500 bg-yellow-50 dark:bg-yellow-950/30';
  return 'border-l-gray-300 dark:border-l-gray-600';
}

function TreeNode({ node, depth }: { node: SessionNode; depth: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ marginLeft: depth * 24 }}>
      <div className={`rounded border-l-4 px-3 py-1.5 mb-1 ${severityClass(node.wait_time_ms)}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono font-bold text-gray-900 dark:text-gray-100">
              SPID {node.session_id}
            </span>
            {depth === 0 && node.children.length > 0 && (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
                HEAD BLOCKER
              </span>
            )}
            <span className="text-gray-500 dark:text-gray-400">{node.login_name}</span>
            <span className="text-gray-400 dark:text-gray-500">{node.database_name}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            {node.wait_type && <span className="font-mono">{node.wait_type}</span>}
            {node.wait_time_ms != null && <span>Wait: {formatDuration(node.wait_time_ms)}</span>}
            {node.elapsed_time_ms != null && <span>Elapsed: {formatDuration(node.elapsed_time_ms)}</span>}
          </div>
        </div>
        {node.current_statement && (
          <div className="mt-1">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {expanded ? 'Hide SQL' : 'Show SQL'}
            </button>
            {expanded && (
              <pre className="mt-1 max-h-32 overflow-auto rounded bg-gray-100 p-2 text-xs font-mono text-gray-700 dark:bg-gray-800 dark:text-gray-300 whitespace-pre-wrap">
                {node.current_statement}
              </pre>
            )}
          </div>
        )}
      </div>
      {node.children.map((child) => (
        <TreeNode key={child.session_id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function BlockingTree({ instanceId }: Props) {
  const { data: chains = [] } = useQuery<SessionNode[]>({
    queryKey: ['blocking-chains', instanceId],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/blocking-chains`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 15_000,
  });

  if (chains.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
        Blocking Chains
        <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-100 px-1.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
          {chains.length}
        </span>
      </h3>
      <div className="space-y-1">
        {chains.map((root) => (
          <TreeNode key={root.session_id} node={root} depth={0} />
        ))}
      </div>
    </div>
  );
}
