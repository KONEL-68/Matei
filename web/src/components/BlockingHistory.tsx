import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';

interface ChainNode {
  spid: number;
  login: string | null;
  hostname: string | null;
  database: string | null;
  app: string | null;
  wait_type: string | null;
  wait_time_ms: number | null;
  wait_resource: string | null;
  sql_text: string | null;
  blocked_by: number | null;
  command: string | null;
}

interface BlockingEvent {
  id: number;
  event_time: string;
  head_blocker_spid: number;
  head_blocker_login: string | null;
  head_blocker_host: string | null;
  head_blocker_app: string | null;
  head_blocker_db: string | null;
  head_blocker_sql: string | null;
  chain_json: ChainNode[];
  total_blocked_count: number;
  max_wait_time_ms: number;
}

interface BlockingHistoryProps {
  instanceId: string;
  range: string;
  timeWindow: { from: string; to: string } | null;
}

interface TreeNodeData {
  node: ChainNode;
  children: TreeNodeData[];
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatTime(iso: string, longRange: boolean): string {
  const d = new Date(iso);
  if (longRange) {
    const day = d.getDate();
    const mon = d.toLocaleString('en-US', { month: 'short' });
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${mon} ${hh}:${mm}`;
  }
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function severityBorder(waitMs: number): string {
  if (waitMs > 300000) return 'border-l-4 border-l-red-500';
  if (waitMs > 60000) return 'border-l-4 border-l-yellow-500';
  return 'border-l-4 border-l-gray-300 dark:border-l-gray-600';
}

function isLongRange(range: string, timeWindow: { from: string; to: string } | null): boolean {
  if (timeWindow) {
    const diff = new Date(timeWindow.to).getTime() - new Date(timeWindow.from).getTime();
    return diff > 24 * 60 * 60 * 1000;
  }
  return range !== '1h';
}

const SQL_KEYWORDS = /\b(SELECT|FROM|WHERE|UPDATE|DELETE|INSERT|JOIN|ON|SET|INTO|VALUES|ORDER|GROUP|BY|HAVING|AND|OR|NOT|IN|EXISTS|CASE|WHEN|THEN|ELSE|END|AS|WITH|UNION|EXCEPT|INTERSECT|CREATE|ALTER|DROP|EXEC|DECLARE|BEGIN|COMMIT|ROLLBACK)\b/gi;
const STRING_LITERAL = /'[^']*'/g;
const COMMENT_LINE = /--[^\n]*/g;
const COMMENT_BLOCK = /\/\*[\s\S]*?\*\//g;

function highlightSql(sql: string): React.ReactNode[] {
  // Tokenize: find all special ranges, then build output
  interface Token {
    start: number;
    end: number;
    type: 'keyword' | 'string' | 'comment';
  }

  const tokens: Token[] = [];

  // Comments first (highest priority)
  let m: RegExpExecArray | null;
  const commentRe = new RegExp(COMMENT_LINE.source + '|' + COMMENT_BLOCK.source, 'g');
  while ((m = commentRe.exec(sql)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length, type: 'comment' });
  }

  // Strings
  const strRe = new RegExp(STRING_LITERAL.source, 'g');
  while ((m = strRe.exec(sql)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length, type: 'string' });
  }

  // Keywords
  const kwRe = new RegExp(SQL_KEYWORDS.source, 'gi');
  while ((m = kwRe.exec(sql)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length, type: 'keyword' });
  }

  // Sort by start, remove overlaps (comments > strings > keywords)
  tokens.sort((a, b) => a.start - b.start || (a.type === 'comment' ? -1 : b.type === 'comment' ? 1 : 0));
  const merged: Token[] = [];
  let lastEnd = -1;
  for (const t of tokens) {
    if (t.start >= lastEnd) {
      merged.push(t);
      lastEnd = t.end;
    }
  }

  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (let i = 0; i < merged.length; i++) {
    const t = merged[i];
    if (t.start > pos) {
      parts.push(sql.slice(pos, t.start));
    }
    const text = sql.slice(t.start, t.end);
    if (t.type === 'keyword') {
      parts.push(<span key={i} className="text-blue-400">{text}</span>);
    } else if (t.type === 'string') {
      parts.push(<span key={i} className="text-green-400">{text}</span>);
    } else {
      parts.push(<span key={i} className="text-gray-500 italic">{text}</span>);
    }
    pos = t.end;
  }
  if (pos < sql.length) {
    parts.push(sql.slice(pos));
  }
  return parts;
}

function buildTree(chain: ChainNode[]): TreeNodeData[] {
  const bySpid = new Map<number, TreeNodeData>();
  for (const node of chain) {
    bySpid.set(node.spid, { node, children: [] });
  }
  const roots: TreeNodeData[] = [];
  for (const node of chain) {
    const treeNode = bySpid.get(node.spid)!;
    if (node.blocked_by == null) {
      roots.push(treeNode);
    } else {
      const parent = bySpid.get(node.blocked_by);
      if (parent) {
        parent.children.push(treeNode);
      } else {
        roots.push(treeNode);
      }
    }
  }
  return roots;
}

function ChainTreeNode({
  treeNode,
  depth,
  isRoot,
  totalBlockingTime,
  instanceId,
}: {
  treeNode: TreeNodeData;
  depth: number;
  isRoot: boolean;
  totalBlockingTime: number | null;
  instanceId: string;
}) {
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const n = treeNode.node;

  const handleViewPlan = async () => {
    setPlanLoading(true);
    setPlanError(null);
    try {
      const res = await authFetch(`/api/metrics/${instanceId}/plans?spid=${n.spid}`);
      if (!res.ok) {
        setPlanError('No plan available');
      }
      // Future: handle plan display
    } catch {
      setPlanError('No plan available');
    } finally {
      setPlanLoading(false);
    }
  };

  return (
    <div style={{ marginLeft: depth * 24 }} className={depth > 0 ? 'border-l-2 border-gray-300 dark:border-gray-600 pl-3' : ''}>
      <div className="rounded border border-gray-200 bg-gray-50 p-3 mb-2 dark:border-gray-700 dark:bg-gray-800">
        {/* SPID + badge */}
        <div className="flex items-center gap-2 mb-2">
          <span className="font-mono font-bold text-gray-900 dark:text-gray-100">
            SPID {n.spid}
          </span>
          {isRoot && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
              HEAD BLOCKER
            </span>
          )}
          {n.command && (
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-mono text-gray-600 dark:bg-gray-700 dark:text-gray-400">
              {n.command}
            </span>
          )}
        </div>

        {/* Detail fields */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {n.hostname && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">Host: </span>
              <span className="text-gray-900 dark:text-gray-100">{n.hostname}</span>
            </div>
          )}
          {n.database && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">Database: </span>
              <span className="text-gray-900 dark:text-gray-100">{n.database}</span>
            </div>
          )}
          {n.app && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">Application: </span>
              <span className="text-gray-900 dark:text-gray-100">{n.app}</span>
            </div>
          )}
          {n.login && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">Login: </span>
              <span className="text-gray-900 dark:text-gray-100">{n.login}</span>
            </div>
          )}
          {isRoot && totalBlockingTime != null && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">Total blocking time: </span>
              <span className="font-medium text-red-600 dark:text-red-400">{formatDuration(totalBlockingTime)}</span>
            </div>
          )}
          {n.wait_time_ms != null && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">Wait time: </span>
              <span className="text-gray-900 dark:text-gray-100">{formatDuration(n.wait_time_ms)}</span>
            </div>
          )}
          {n.wait_type && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">Wait type: </span>
              <span className="font-mono text-gray-900 dark:text-gray-100">{n.wait_type}</span>
            </div>
          )}
          {n.wait_resource && (
            <div className="col-span-2">
              <span className="text-gray-500 dark:text-gray-400">Wait resource: </span>
              <span className="font-mono text-xs text-gray-900 dark:text-gray-100">{n.wait_resource}</span>
            </div>
          )}
        </div>

        {/* SQL text */}
        {n.sql_text && (
          <div className="mt-2">
            <pre className="max-h-40 overflow-auto rounded bg-gray-900 p-2.5 text-xs font-mono text-gray-300 dark:bg-gray-950 whitespace-pre-wrap">
              {highlightSql(n.sql_text)}
            </pre>
          </div>
        )}

        {/* View Estimated Plan button */}
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={handleViewPlan}
            disabled={planLoading}
            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {planLoading ? 'Loading...' : 'View Estimated Plan'}
          </button>
          {planError && (
            <span className="text-xs text-gray-500 dark:text-gray-400">{planError}</span>
          )}
        </div>
      </div>

      {/* Children */}
      {treeNode.children.map((child) => (
        <ChainTreeNode
          key={child.node.spid}
          treeNode={child}
          depth={depth + 1}
          isRoot={false}
          totalBlockingTime={null}
          instanceId={instanceId}
        />
      ))}
    </div>
  );
}

interface BlockingConfig {
  blocked_process_threshold: number;
}

export function BlockingHistory({ instanceId, range, timeWindow }: BlockingHistoryProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const longRange = isLongRange(range, timeWindow);

  const queryParams = timeWindow
    ? `from=${encodeURIComponent(timeWindow.from)}&to=${encodeURIComponent(timeWindow.to)}`
    : `range=${range}`;

  const { data: events = [] } = useQuery<BlockingEvent[]>({
    queryKey: ['blocking-history', instanceId, range, timeWindow],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/blocking?${queryParams}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: blockingConfig } = useQuery<BlockingConfig>({
    queryKey: ['blocking-config', instanceId],
    queryFn: async () => {
      const res = await authFetch(`/api/metrics/${instanceId}/blocking/config`);
      if (!res.ok) throw new Error('Failed to fetch blocking config');
      return res.json();
    },
    refetchInterval: 60_000,
    retry: false,
  });

  const thresholdNotConfigured = blockingConfig != null && blockingConfig.blocked_process_threshold === 0;

  const expandedEvent = useMemo(
    () => events.find((e) => e.id === expandedId) ?? null,
    [events, expandedId],
  );

  const expandedTree = useMemo(
    () => (expandedEvent ? buildTree(expandedEvent.chain_json) : []),
    [expandedEvent],
  );

  const totalBlockingTime = useMemo(() => {
    if (!expandedEvent) return null;
    let sum = 0;
    for (const node of expandedEvent.chain_json) {
      if (node.wait_time_ms != null) sum += node.wait_time_ms;
    }
    return sum;
  }, [expandedEvent]);

  if (events.length === 0) {
    return (
      <div>
        {thresholdNotConfigured && (
          <div className="mb-3 rounded border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-700 dark:bg-yellow-900/20">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              &#x26A0; Blocked Process Threshold is not configured on this server. Blocking detection requires:
            </p>
            <code className="mt-2 block whitespace-pre rounded bg-yellow-100 p-2 font-mono text-xs text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
              {"EXEC sp_configure 'show advanced options', 1; RECONFIGURE;\nEXEC sp_configure 'blocked process threshold', 10; RECONFIGURE;"}
            </code>
          </div>
        )}
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {thresholdNotConfigured ? (
            <p>No blocking events can be detected until the blocked process threshold is configured.</p>
          ) : (
            <p>No blocking events detected in this time range.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {thresholdNotConfigured && (
        <div className="mb-3 rounded border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-700 dark:bg-yellow-900/20">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            &#x26A0; Blocked Process Threshold is not configured on this server. Blocking detection requires:
          </p>
          <code className="mt-2 block whitespace-pre rounded bg-yellow-100 p-2 font-mono text-xs text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
            {"EXEC sp_configure 'show advanced options', 1; RECONFIGURE;\nEXEC sp_configure 'blocked process threshold', 10; RECONFIGURE;"}
          </code>
        </div>
      )}
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          <tr>
            <th className="px-4 py-2">Time First Occurs</th>
            <th className="px-4 py-2">Head Blocker</th>
            <th className="px-4 py-2">Database</th>
            <th className="px-4 py-2">Application</th>
            <th className="px-4 py-2 text-right">Blocked</th>
            <th className="px-4 py-2 text-right">Max Wait</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {events.map((evt) => (
            <tr
              key={evt.id}
              onClick={() => setExpandedId(expandedId === evt.id ? null : evt.id)}
              className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 ${severityBorder(evt.max_wait_time_ms)} ${
                expandedId === evt.id ? 'bg-gray-50 dark:bg-gray-800/30' : ''
              }`}
            >
              <td className="px-4 py-2 text-gray-900 dark:text-gray-100 whitespace-nowrap font-mono text-xs">
                {formatTime(evt.event_time, longRange)}
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-gray-900 dark:text-gray-100">SPID {evt.head_blocker_spid}</span>
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
                    Head Blocker
                  </span>
                  {evt.head_blocker_login && (
                    <span className="text-gray-500 dark:text-gray-400 text-xs">{evt.head_blocker_login}</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-2 text-gray-600 dark:text-gray-400 text-xs">
                {evt.head_blocker_db ?? '-'}
              </td>
              <td className="px-4 py-2 text-gray-600 dark:text-gray-400 text-xs max-w-[200px] truncate">
                {evt.head_blocker_app ?? '-'}
              </td>
              <td className="px-4 py-2 text-right">
                <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-orange-100 px-1.5 text-xs font-medium text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                  {evt.total_blocked_count}
                </span>
              </td>
              <td className="px-4 py-2 text-right text-xs font-mono text-gray-900 dark:text-gray-100 whitespace-nowrap">
                {formatDuration(evt.max_wait_time_ms)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Expanded blocking chain tree */}
      {expandedId !== null && expandedEvent && (
        <div className="border-t border-gray-200 p-4 dark:border-gray-700">
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">
            Blocking Chain
          </h4>
          <div>
            {expandedTree.map((root) => (
              <ChainTreeNode
                key={root.node.spid}
                treeNode={root}
                depth={0}
                isRoot={true}
                totalBlockingTime={totalBlockingTime}
                instanceId={instanceId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
