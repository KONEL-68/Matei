import type sql from 'mssql';

export interface OsCpuRow {
  record_id: number;
  event_time_utc: Date;
  system_idle_pct: number;
  sql_cpu_pct: number;
  other_process_cpu_pct: number;
  collected_at_utc: Date;
}

const QUERY = `
SELECT TOP 1
    x.value('(./Record/@id)[1]', 'int') AS record_id,
    DATEADD(ms, -1 * (si.ms_ticks - rb.timestamp), GETUTCDATE()) AS event_time_utc,
    x.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int') AS system_idle_pct,
    x.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS sql_cpu_pct,
    100 - x.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int')
        - x.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS other_process_cpu_pct,
    GETUTCDATE() AS collected_at_utc
FROM (
    SELECT
        timestamp,
        CONVERT(XML, record) AS x
    FROM sys.dm_os_ring_buffers
    WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
      AND record LIKE N'%<SystemHealth>%'
) rb
CROSS JOIN sys.dm_os_sys_info si
ORDER BY rb.timestamp DESC
`;

export async function collectOsCpu(request: sql.Request): Promise<OsCpuRow[]> {
  const result = await request.query(QUERY);
  return result.recordset as OsCpuRow[];
}
