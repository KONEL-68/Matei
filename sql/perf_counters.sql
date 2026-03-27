-- Performance counters from sys.dm_os_performance_counters
-- Source: sys.dm_os_performance_counters
-- Collection frequency: 30s
-- Delta types: cntr_type 272696576 = per-second cumulative (needs delta)
--              cntr_type 65792 = instantaneous (store as-is)
-- Validation: SELECT * FROM sys.dm_os_performance_counters WHERE counter_name = 'Batch Requests/sec'

SELECT
    RTRIM(counter_name) AS counter_name,
    cntr_value,
    cntr_type  -- 272696576 = per-second rate (needs delta), 65792 = instantaneous
FROM sys.dm_os_performance_counters
WHERE counter_name IN (
    'Batch Requests/sec',
    'SQL Compilations/sec',
    'SQL Re-Compilations/sec',
    'Logins/sec',
    'Logouts/sec',
    'Transactions/sec',
    'User Connections',
    'Processes blocked',
    'Page life expectancy',
    'Lazy writes/sec',
    'Checkpoint pages/sec',
    'Lock Waits/sec',
    'Deadlocks/sec',
    'Database Cache Memory (KB)',
    'SQL Cache Memory (KB)',
    'Total Server Memory (KB)',
    'Target Server Memory (KB)',
    'Stolen Server Memory (KB)',
    'Memory Grants Pending',
    'Memory Grants Outstanding',
    'Bytes Sent to Replica/sec',
    'Bytes Received from Replica/sec',
    'Page Splits/sec',
    'Full Scans/sec',
    'Lock Timeouts/sec',
    'Latch Waits/sec',
    'Total Latch Wait Time (ms)'
)
AND instance_name IN ('', '_Total')
