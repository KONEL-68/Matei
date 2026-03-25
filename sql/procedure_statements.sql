-- Source: sys.dm_exec_query_stats + sys.dm_exec_sql_text
-- Collection frequency: on-demand (API only)
-- Aggregation: snapshot (cumulative since plan cache entry)
-- Units: counts, milliseconds, page reads/writes, KB (memory grants)
-- UI: expandable detail view in Top Procedures tab
-- Validation: SELECT OBJECT_ID(@qualifiedName) — should return non-NULL
-- Parameters: @qualifiedName (3-part: 'DbName.dbo.MyProc'), @dbName (database name)
-- Note: OBJECT_ID needs 3-part name to resolve across databases (connection may be in master)

SELECT TOP 20
    SUBSTRING(qt.text, (qs.statement_start_offset/2) + 1,
        ((CASE qs.statement_end_offset
            WHEN -1 THEN DATALENGTH(qt.text)
            ELSE qs.statement_end_offset END
            - qs.statement_start_offset)/2) + 1) AS statement_text,
    qs.execution_count,
    qs.total_worker_time / 1000 AS total_cpu_ms,
    qs.total_elapsed_time / 1000 AS total_elapsed_ms,
    qs.total_physical_reads AS physical_reads,
    qs.total_logical_reads AS logical_reads,
    qs.total_logical_writes AS logical_writes,
    CASE WHEN qs.execution_count > 0
         THEN qs.total_worker_time / 1000.0 / qs.execution_count ELSE 0 END AS avg_cpu_ms,
    CASE WHEN qs.execution_count > 0
         THEN qs.total_elapsed_time / 1000.0 / qs.execution_count ELSE 0 END AS avg_elapsed_ms,
    qs.last_execution_time,
    qs.min_grant_kb,
    qs.last_grant_kb
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
WHERE qt.objectid = OBJECT_ID(@qualifiedName)
  AND qt.dbid = DB_ID(@dbName)
ORDER BY qs.total_worker_time DESC;
