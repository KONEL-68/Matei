interface WaitRow {
  wait_type: string;
  wait_ms_per_sec: number;
  wait_time_ms: number;
}

interface TopWaitsTableProps {
  data: WaitRow[];
}

export function TopWaitsTable({ data }: TopWaitsTableProps) {
  if (data.length === 0) return null;

  const top5 = [...data]
    .sort((a, b) => b.wait_ms_per_sec - a.wait_ms_per_sec)
    .slice(0, 5);

  const totalMs = top5.reduce((s, r) => s + r.wait_time_ms, 0);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Top Waits</h3>
      <table className="w-full text-left text-sm">
        <thead className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
          <tr>
            <th className="py-1 pr-3">Wait Type</th>
            <th className="py-1 pr-3 text-right w-[100px]">ms/sec</th>
            <th className="py-1 text-right w-[100px]">% of total</th>
          </tr>
        </thead>
        <tbody>
          {top5.map((row) => {
            const pct = totalMs > 0 ? (row.wait_time_ms / totalMs) * 100 : 0;
            const bg = row.wait_ms_per_sec > 10
              ? 'bg-red-50 dark:bg-red-950/30'
              : row.wait_ms_per_sec > 2
                ? 'bg-yellow-50 dark:bg-yellow-950/30'
                : '';
            return (
              <tr key={row.wait_type} className={bg}>
                <td className="py-1 pr-3 font-mono text-xs text-gray-900 dark:text-gray-100">{row.wait_type}</td>
                <td className="py-1 pr-3 text-right font-medium text-gray-700 dark:text-gray-300">{row.wait_ms_per_sec.toFixed(1)}</td>
                <td className="py-1 text-right text-gray-500 dark:text-gray-400">{pct.toFixed(0)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
