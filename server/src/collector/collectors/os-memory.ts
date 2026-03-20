import type sql from 'mssql';

export interface OsMemoryRow {
  os_total_memory_mb: number;
  os_available_memory_mb: number;
  os_used_memory_mb: number;
  os_memory_used_pct: number;
  os_page_file_total_mb: number;
  os_page_file_available_mb: number;
  system_memory_state_desc: string;
  sql_physical_memory_mb: number;
  sql_locked_pages_mb: number;
  sql_virtual_committed_mb: number;
  sql_memory_utilization_pct: number;
  sql_memory_low_notification: boolean;
  sql_virtual_memory_low_notification: boolean;
  sql_committed_mb: number;
  sql_target_mb: number;
  collected_at_utc: Date;
}

const QUERY = `
SELECT
    sm.total_physical_memory_kb / 1024              AS os_total_memory_mb,
    sm.available_physical_memory_kb / 1024           AS os_available_memory_mb,
    (sm.total_physical_memory_kb - sm.available_physical_memory_kb) / 1024 AS os_used_memory_mb,
    CAST(100.0 * (sm.total_physical_memory_kb - sm.available_physical_memory_kb)
        / NULLIF(sm.total_physical_memory_kb, 0) AS DECIMAL(5,2)) AS os_memory_used_pct,
    sm.total_page_file_kb / 1024                     AS os_page_file_total_mb,
    sm.available_page_file_kb / 1024                 AS os_page_file_available_mb,
    sm.system_memory_state_desc,
    pm.physical_memory_in_use_kb / 1024              AS sql_physical_memory_mb,
    pm.locked_page_allocations_kb / 1024             AS sql_locked_pages_mb,
    pm.virtual_address_space_committed_kb / 1024     AS sql_virtual_committed_mb,
    pm.memory_utilization_percentage                 AS sql_memory_utilization_pct,
    pm.process_physical_memory_low                   AS sql_memory_low_notification,
    pm.process_virtual_memory_low                    AS sql_virtual_memory_low_notification,
    si.committed_kb / 1024                           AS sql_committed_mb,
    si.committed_target_kb / 1024                    AS sql_target_mb,
    GETUTCDATE()                                     AS collected_at_utc
FROM sys.dm_os_sys_memory sm
CROSS JOIN sys.dm_os_process_memory pm
CROSS JOIN sys.dm_os_sys_info si
`;

export async function collectOsMemory(request: sql.Request): Promise<OsMemoryRow[]> {
  const result = await request.query(QUERY);
  return result.recordset as OsMemoryRow[];
}
