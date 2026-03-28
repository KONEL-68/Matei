-- Blocked process report collection from matei_blocking Extended Events session
-- Source: sys.dm_xe_session_targets (ring_buffer) for matei_blocking session
-- Collection frequency: 60s (every 2nd cycle)
-- Aggregation: snapshot (event-based, not cumulative)
-- Units: duration in milliseconds, wait_time in milliseconds
-- UI: Blocking history table with blocked/blocker details and drill-down to full XML
--
-- Prerequisites:
--   1. DBA must enable 'blocked process threshold' server configuration (recommended: 10 seconds)
--   2. The matei_blocking XE session is auto-created by the collector if it doesn't exist.
--      If the session exists but is misconfigured, the collector drops and recreates it.
--
-- Validation: Run on any SQL Server 2016+ with the matei_blocking session active.
-- If no blocking has occurred since @since, the query returns 0 rows.
-- Requires: VIEW SERVER STATE
--
-- === DBA SETUP (run on monitored SQL Server) ===
--
-- EXEC sp_configure 'show advanced options', 1; RECONFIGURE;
-- EXEC sp_configure 'blocked process threshold', 10; RECONFIGURE;
--
-- CREATE EVENT SESSION [matei_blocking] ON SERVER
-- ADD EVENT sqlserver.blocked_process_report
-- ADD TARGET package0.ring_buffer (SET max_memory = 4096)
-- WITH (MAX_DISPATCH_LATENCY = 5 SECONDS, STARTUP_STATE = ON);
--
-- ALTER EVENT SESSION [matei_blocking] ON SERVER STATE = START;
--
-- ==============================================

SELECT
    xed.value('(@timestamp)[1]', 'DATETIMEOFFSET') AT TIME ZONE 'UTC' AS event_time_utc,
    xed.value('(data[@name="duration"]/value)[1]', 'BIGINT') / 1000 AS duration_ms,

    -- Blocked process details (direct XPath — avoids CROSS APPLY which drops rows on XPath mismatch)
    xed.value('(data[@name="blocked_process"]/value/blocked-process-report/blocked-process/process/@spid)[1]', 'INT') AS blocked_spid,
    xed.value('(data[@name="blocked_process"]/value/blocked-process-report/blocked-process/process/@loginname)[1]', 'NVARCHAR(128)') AS blocked_login,
    xed.value('(data[@name="blocked_process"]/value/blocked-process-report/blocked-process/process/@hostname)[1]', 'NVARCHAR(128)') AS blocked_hostname,
    DB_NAME(xed.value('(data[@name="blocked_process"]/value/blocked-process-report/blocked-process/process/@currentdb)[1]', 'INT')) AS blocked_database,
    xed.value('(data[@name="blocked_process"]/value/blocked-process-report/blocked-process/process/@clientapp)[1]', 'NVARCHAR(256)') AS blocked_app,
    xed.value('(data[@name="blocked_process"]/value/blocked-process-report/blocked-process/process/@waittype)[1]', 'NVARCHAR(128)') AS blocked_wait_type,
    xed.value('(data[@name="blocked_process"]/value/blocked-process-report/blocked-process/process/@waittime)[1]', 'BIGINT') AS blocked_wait_time_ms,
    xed.value('(data[@name="blocked_process"]/value/blocked-process-report/blocked-process/process/@waitresource)[1]', 'NVARCHAR(256)') AS blocked_wait_resource,
    xed.value('(data[@name="blocked_process"]/value/blocked-process-report/blocked-process/process/inputbuf)[1]', 'NVARCHAR(MAX)') AS blocked_inputbuf,

    -- Blocking process details (direct XPath)
    xed.value('(data[@name="blocked_process"]/value/blocked-process-report/blocking-process/process/@spid)[1]', 'INT') AS blocker_spid,
    xed.value('(data[@name="blocked_process"]/value/blocked-process-report/blocking-process/process/@loginname)[1]', 'NVARCHAR(128)') AS blocker_login,
    xed.value('(data[@name="blocked_process"]/value/blocked-process-report/blocking-process/process/@hostname)[1]', 'NVARCHAR(128)') AS blocker_hostname,
    DB_NAME(xed.value('(data[@name="blocked_process"]/value/blocked-process-report/blocking-process/process/@currentdb)[1]', 'INT')) AS blocker_database,
    xed.value('(data[@name="blocked_process"]/value/blocked-process-report/blocking-process/process/@clientapp)[1]', 'NVARCHAR(256)') AS blocker_app,
    xed.value('(data[@name="blocked_process"]/value/blocked-process-report/blocking-process/process/inputbuf)[1]', 'NVARCHAR(MAX)') AS blocker_inputbuf
FROM (
    SELECT CAST(target_data AS XML) AS target_data
    FROM sys.dm_xe_session_targets st
    JOIN sys.dm_xe_sessions s ON s.address = st.event_session_address
    WHERE s.name = 'matei_blocking'
      AND st.target_name = 'ring_buffer'
) AS data
CROSS APPLY target_data.nodes('RingBufferTarget/event[@name="blocked_process_report"]') AS xev(xed)
WHERE xed.value('(@timestamp)[1]', 'DATETIMEOFFSET') > @since
ORDER BY event_time_utc DESC
