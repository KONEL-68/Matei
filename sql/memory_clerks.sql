-- Metric: Memory Clerks
-- Source: sys.dm_os_memory_clerks
-- Frequency: 60 seconds (every 2nd cycle)
-- Aggregation: snapshot
-- Units: MB
-- UI: Memory Clerks breakdown table/chart on Instance Detail page
-- Docs: https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-views/sys-dm-os-memory-clerks-transact-sql
--
-- Validation: SELECT COUNT(*) FROM sys.dm_os_memory_clerks WHERE pages_kb > 0

SELECT
    type AS clerk_type,
    SUM(pages_kb) / 1024.0 AS size_mb
FROM sys.dm_os_memory_clerks
GROUP BY type
HAVING SUM(pages_kb) > 0
ORDER BY SUM(pages_kb) DESC
