-- Metric: Wait Stats
-- Source: sys.dm_os_wait_stats
-- Frequency: 30 seconds
-- Aggregation: DELTA (cumulative counters — must compute difference between snapshots)
-- Docs: https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-views/sys-dm-os-wait-stats-transact-sql
--
-- IMPORTANT: Raw values are cumulative since SQL Server start.
-- Collector must:
--   1. Store previous snapshot in memory
--   2. Compute delta = (current - previous) / elapsed_seconds
--   3. Write only deltas to PostgreSQL
--   4. If sqlserver_start_time changed → skip delta (instance restarted)

SELECT
    wait_type,
    waiting_tasks_count,
    wait_time_ms,
    max_wait_time_ms,
    signal_wait_time_ms,
    GETUTCDATE() AS collected_at_utc
FROM sys.dm_os_wait_stats
WHERE wait_type NOT IN (
    SELECT value FROM OPENJSON(
        (SELECT BulkColumn FROM OPENROWSET(BULK '/sql/excluded_waits.json', SINGLE_CLOB) x)
    )
)
  AND wait_time_ms > 0
ORDER BY wait_time_ms DESC;

-- NOTE: The WHERE clause above assumes excluded_waits.json is loaded.
-- In practice, the collector loads the exclusion list from /sql/excluded_waits.json
-- and builds the NOT IN clause dynamically. The query above is for documentation.
--
-- Simplified collector query (exclusion list applied in code):
--
-- SELECT
--     wait_type,
--     waiting_tasks_count,
--     wait_time_ms,
--     max_wait_time_ms,
--     signal_wait_time_ms
-- FROM sys.dm_os_wait_stats
-- WHERE wait_time_ms > 0
-- ORDER BY wait_time_ms DESC;
