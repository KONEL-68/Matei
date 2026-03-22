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
WHERE (
    (RTRIM(counter_name) = 'Page life expectancy' AND object_name LIKE '%Buffer Manager%')
    OR (RTRIM(counter_name) = 'Batch Requests/sec' AND object_name LIKE '%SQL Statistics%')
    OR (RTRIM(counter_name) = 'SQL Compilations/sec' AND object_name LIKE '%SQL Statistics%')
    OR (RTRIM(counter_name) = 'SQL Re-Compilations/sec' AND object_name LIKE '%SQL Statistics%')
    OR (RTRIM(counter_name) = 'User Connections' AND object_name LIKE '%General Statistics%')
    OR (RTRIM(counter_name) = 'Processes blocked' AND object_name LIKE '%General Statistics%')
    OR (RTRIM(counter_name) = 'Logins/sec' AND object_name LIKE '%General Statistics%')
    OR (RTRIM(counter_name) = 'Logouts/sec' AND object_name LIKE '%General Statistics%')
    OR (RTRIM(counter_name) = 'Transactions/sec' AND object_name LIKE '%Databases%' AND instance_name = '_Total')
    OR (RTRIM(counter_name) = 'Deadlocks/sec' AND object_name LIKE '%Locks%' AND instance_name = '_Total')
    OR (RTRIM(counter_name) = 'Lazy writes/sec' AND object_name LIKE '%Buffer Manager%')
    OR (RTRIM(counter_name) = 'Checkpoint pages/sec' AND object_name LIKE '%Buffer Manager%')
    OR (RTRIM(counter_name) = 'Lock Waits/sec' AND object_name LIKE '%Locks%' AND instance_name = '_Total')
    OR (RTRIM(counter_name) = 'Database Cache Memory (KB)' AND object_name LIKE '%Memory Manager%')
    OR (RTRIM(counter_name) = 'SQL Cache Memory (KB)' AND object_name LIKE '%Memory Manager%')
)
