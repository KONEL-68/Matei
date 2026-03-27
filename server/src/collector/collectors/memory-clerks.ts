import type sql from 'mssql';

export interface MemoryClerkRow {
  clerk_type: string;
  size_mb: number;
}

const QUERY = `
SELECT
    type AS clerk_type,
    SUM(pages_kb) / 1024.0 AS size_mb
FROM sys.dm_os_memory_clerks
GROUP BY type
HAVING SUM(pages_kb) > 0
ORDER BY SUM(pages_kb) DESC
`;

export async function collectMemoryClerks(request: sql.Request): Promise<MemoryClerkRow[]> {
  const result = await request.query(QUERY);
  return result.recordset as MemoryClerkRow[];
}
