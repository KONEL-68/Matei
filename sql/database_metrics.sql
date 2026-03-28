-- Per-database performance counters from sys.dm_os_performance_counters
-- Source: sys.dm_os_performance_counters (Databases object)
-- Collection frequency: 60s (every 2nd cycle)
-- Delta types: cntr_type 272696576 = per-second cumulative (needs delta)
--              cntr_type 65792 = instantaneous (store as-is)
-- Validation: SELECT * FROM sys.dm_os_performance_counters WHERE object_name LIKE '%:Databases%' AND instance_name = 'master'

SELECT
    RTRIM(instance_name) AS database_name,
    RTRIM(counter_name) AS counter_name,
    cntr_value,
    cntr_type
FROM sys.dm_os_performance_counters
WHERE object_name LIKE '%:Databases%'
  AND instance_name NOT IN ('_Total', 'mssqlsystemresource')
  AND counter_name IN (
    'Data File(s) Size (KB)',
    'Log File(s) Size (KB)',
    'Log File(s) Used Size (KB)',
    'Transactions/sec',
    'Write Transactions/sec',
    'Active Transactions',
    'Log Flushes/sec',
    'Log Bytes Flushed/sec',
    'Log Flush Waits/sec'
  )
