-- Source: sys.dm_exec_procedure_stats
-- Collection frequency: 60s (every 2nd cycle), delta
-- Aggregation: delta computation same as query_stats
-- Units: counts, microseconds (converted to ms in collector), page reads/writes
-- Validation: SELECT COUNT(*) FROM sys.dm_exec_procedure_stats WHERE database_id > 4

SELECT TOP 50
    ps.database_id,
    ps.object_id,
    ISNULL(DB_NAME(ps.database_id), '?') AS database_name,
    ISNULL(OBJECT_SCHEMA_NAME(ps.object_id, ps.database_id), 'dbo') + '.' + OBJECT_NAME(ps.object_id, ps.database_id) AS procedure_name,
    SUM(ps.execution_count) AS execution_count,
    SUM(ps.total_worker_time) AS total_worker_time,
    SUM(ps.total_elapsed_time) AS total_elapsed_time,
    SUM(ps.total_logical_reads) AS total_logical_reads,
    SUM(ps.total_logical_writes) AS total_logical_writes,
    MAX(ps.last_execution_time) AS last_execution_time,
    GETUTCDATE() AS collected_at_utc
FROM sys.dm_exec_procedure_stats ps
WHERE ps.database_id > 4
GROUP BY ps.database_id, ps.object_id
HAVING OBJECT_NAME(ps.object_id, ps.database_id) IS NOT NULL
ORDER BY SUM(ps.total_worker_time) DESC;
