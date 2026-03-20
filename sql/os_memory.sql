-- Metric: OS Memory
-- Source: sys.dm_os_sys_memory + sys.dm_os_process_memory
-- Frequency: 30 seconds
-- Aggregation: snapshot
-- Docs: https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-views/sys-dm-os-sys-memory-transact-sql

SELECT
    -- OS level
    sm.total_physical_memory_kb / 1024              AS os_total_memory_mb,
    sm.available_physical_memory_kb / 1024           AS os_available_memory_mb,
    (sm.total_physical_memory_kb - sm.available_physical_memory_kb) / 1024 AS os_used_memory_mb,
    CAST(100.0 * (sm.total_physical_memory_kb - sm.available_physical_memory_kb)
        / NULLIF(sm.total_physical_memory_kb, 0) AS DECIMAL(5,2)) AS os_memory_used_pct,
    sm.total_page_file_kb / 1024                     AS os_page_file_total_mb,
    sm.available_page_file_kb / 1024                 AS os_page_file_available_mb,
    sm.system_memory_state_desc,

    -- SQL Server process level
    pm.physical_memory_in_use_kb / 1024              AS sql_physical_memory_mb,
    pm.locked_page_allocations_kb / 1024             AS sql_locked_pages_mb,
    pm.virtual_address_space_committed_kb / 1024     AS sql_virtual_committed_mb,
    pm.memory_utilization_percentage                 AS sql_memory_utilization_pct,
    pm.process_physical_memory_low                   AS sql_memory_low_notification,
    pm.process_virtual_memory_low                    AS sql_virtual_memory_low_notification,

    -- SQL Server memory targets
    si.committed_kb / 1024                           AS sql_committed_mb,
    si.committed_target_kb / 1024                    AS sql_target_mb,

    GETUTCDATE()                                     AS collected_at_utc
FROM sys.dm_os_sys_memory sm
CROSS JOIN sys.dm_os_process_memory pm
CROSS JOIN sys.dm_os_sys_info si;
