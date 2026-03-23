-- Metric: Active Sessions + Blocking Tree
-- Source: sys.dm_exec_sessions + sys.dm_exec_requests + sys.dm_exec_sql_text
-- Frequency: 15 seconds
-- Aggregation: snapshot (current state only)
--
-- Rules:
--   - Only user processes (is_user_process = 1) unless explicitly viewing system
--   - Include sessions with active requests OR open transactions
--   - blocking_session_id > 0 = this session is BLOCKED BY that session
--   - Head blocker = blocks others but is not itself blocked
--   - NEVER call dm_exec_query_plan() here — too expensive for hot path
--     Use it only on-demand in the API when user opens session detail

SELECT
    s.session_id,
    r.request_id,
    r.blocking_session_id,
    s.status                                        AS session_status,
    r.status                                        AS request_status,
    s.login_name,
    s.host_name,
    s.program_name,
    DB_NAME(r.database_id)                          AS database_name,
    r.command,
    r.wait_type,
    r.wait_time                                     AS wait_time_ms,
    r.wait_resource,
    r.total_elapsed_time                            AS elapsed_time_ms,
    r.cpu_time                                      AS cpu_time_ms,
    r.reads                                         AS logical_reads,
    r.writes,
    r.row_count,
    r.open_transaction_count,
    s.transaction_isolation_level,
    CASE s.transaction_isolation_level
        WHEN 0 THEN 'Unspecified'
        WHEN 1 THEN 'READ UNCOMMITTED'
        WHEN 2 THEN 'READ COMMITTED'
        WHEN 3 THEN 'REPEATABLE READ'
        WHEN 4 THEN 'SERIALIZABLE'
        WHEN 5 THEN 'SNAPSHOT'
    END                                             AS isolation_level_desc,
    r.granted_query_memory                          AS granted_memory_kb,
    SUBSTRING(st.text, (r.statement_start_offset/2)+1,
        ((CASE r.statement_end_offset
            WHEN -1 THEN DATALENGTH(st.text)
            ELSE r.statement_end_offset
          END - r.statement_start_offset)/2)+1)     AS current_statement,
    st.text                                         AS full_sql_text,
    r.plan_handle,
    r.sql_handle,
    GETUTCDATE()                                    AS collected_at_utc
FROM sys.dm_exec_sessions s
LEFT JOIN sys.dm_exec_requests r ON s.session_id = r.session_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) st
WHERE s.is_user_process = 1
  AND s.program_name <> 'Matei Monitor'
  AND (
      r.session_id IS NOT NULL          -- has active request
      OR s.open_transaction_count > 0   -- has open transaction (sleeping with locks)
  )
ORDER BY
    CASE WHEN r.blocking_session_id > 0 THEN 0 ELSE 1 END,  -- blocked first
    r.total_elapsed_time DESC NULLS LAST;
