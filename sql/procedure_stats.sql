-- Source: sys.dm_exec_procedure_stats
-- Collection frequency: 60s (every 2nd cycle), delta
-- Aggregation: delta computation same as query_stats
-- Units: counts, milliseconds, page reads

SELECT
    DB_NAME(database_id)                AS database_name,
    OBJECT_SCHEMA_NAME(object_id, database_id) + '.' + OBJECT_NAME(object_id, database_id) AS procedure_name,
    execution_count,
    total_worker_time / 1000            AS total_cpu_ms,
    total_elapsed_time / 1000           AS total_elapsed_ms,
    total_logical_reads                 AS total_reads,
    total_logical_writes                AS total_writes,
    CASE WHEN execution_count > 0
         THEN total_worker_time / 1000.0 / execution_count
         ELSE 0 END                     AS avg_cpu_ms,
    CASE WHEN execution_count > 0
         THEN total_elapsed_time / 1000.0 / execution_count
         ELSE 0 END                     AS avg_elapsed_ms,
    CASE WHEN execution_count > 0
         THEN total_logical_reads * 1.0 / execution_count
         ELSE 0 END                     AS avg_reads,
    last_execution_time
FROM sys.dm_exec_procedure_stats
WHERE database_id > 4  -- exclude system databases
ORDER BY total_worker_time DESC;
