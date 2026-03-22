export function RetentionSettings() {
  const policies = [
    { tier: 'Raw metrics', retention: '7 days', detail: 'Full-resolution data, partitioned by day' },
    { tier: '5-minute aggregates', retention: '30 days', detail: 'Averaged/rolled-up metrics' },
    { tier: 'Hourly aggregates', retention: '1 year', detail: 'Long-term trend data' },
  ];

  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Data retention policy (read-only). Managed by the background partition manager.
      </p>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          <tr>
            <th className="px-4 py-2">Tier</th>
            <th className="px-4 py-2">Retention</th>
            <th className="px-4 py-2">Detail</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {policies.map((p) => (
            <tr key={p.tier}>
              <td className="px-4 py-2 font-medium text-gray-900 dark:text-gray-100">{p.tier}</td>
              <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{p.retention}</td>
              <td className="px-4 py-2 text-gray-500 dark:text-gray-500">{p.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
