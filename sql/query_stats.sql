-- Query Performance Stats (delta-based, cumulative counters)
-- Source: sys.dm_exec_query_stats + sys.dm_exec_sql_text
-- Frequency: every 60 seconds (every 2nd collector cycle)
-- Aggregation: delta (compute difference between snapshots)
-- NEVER call dm_exec_query_plan in collector hot path — only on-demand via API

-- Validation: run manually and compare with Matei output
-- SELECT TOP 10 * FROM sys.dm_exec_query_stats ORDER BY total_worker_time DESC

SELECT TOP 50
    qs.query_hash,
    qs.sql_handle,
    qs.statement_start_offset,
    qs.statement_end_offset,
    qs.execution_count,
    qs.total_worker_time,
    qs.total_elapsed_time,
    qs.total_logical_reads,
    qs.total_logical_writes,
    qs.total_rows,
    qs.creation_time,
    qs.last_execution_time,
    DB_NAME(st.dbid)               AS database_name,
    SUBSTRING(
        st.text,
        (qs.statement_start_offset / 2) + 1,
        (CASE
            WHEN qs.statement_end_offset = -1
            THEN DATALENGTH(st.text)
            ELSE qs.statement_end_offset
        END - qs.statement_start_offset) / 2 + 1
    )                               AS statement_text,
    qs.last_grant_kb,
    qs.last_used_grant_kb,
    GETUTCDATE()                    AS collected_at_utc
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
ORDER BY qs.total_worker_time DESC
