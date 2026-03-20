-- Metric: OS + SQL CPU Utilization
-- Source: sys.dm_os_ring_buffers (RING_BUFFER_SCHEDULER_MONITOR)
-- Frequency: 30 seconds
-- Aggregation: snapshot (values are already per-point-in-time percentages)
-- Docs: https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-views/sys-dm-os-ring-buffers-transact-sql
--
-- Returns last 256 data points (~4 hours at 1-min intervals from SQL Server internal)
-- We only need the latest record each collection cycle.
--
-- NOTE: This DMV is deprecated in SQL Server 2025. For future-proofing,
-- consider also supporting sys.dm_os_ring_buffer_entries when available.

SELECT TOP 1
    record_id,
    DATEADD(ms, -1 * (si.ms_ticks - rb.timestamp), GETUTCDATE()) AS event_time_utc,
    x.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int') AS system_idle_pct,
    x.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS sql_cpu_pct,
    100 - x.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int')
        - x.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS other_process_cpu_pct,
    GETUTCDATE() AS collected_at_utc
FROM (
    SELECT
        timestamp,
        record_id,
        CONVERT(XML, record) AS x
    FROM sys.dm_os_ring_buffers
    WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
      AND record LIKE N'%<SystemHealth>%'
) rb
CROSS JOIN sys.dm_os_sys_info si
ORDER BY rb.record_id DESC;
