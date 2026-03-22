-- Deadlock detection from system_health Extended Events session
-- Source: sys.dm_xe_session_targets (ring_buffer) for system_health
-- Collection frequency: 60s
-- Aggregation: snapshot (event-based, not cumulative)
-- No objects created on target — system_health runs by default
--
-- Validation: Run on any SQL Server 2012+ with system_health session active.
-- If no deadlocks have occurred, the query returns 0 rows.

SELECT
    xed.value('(@timestamp)[1]', 'DATETIMEOFFSET') AT TIME ZONE 'UTC' AS deadlock_time_utc,
    xed.query('.') AS deadlock_graph
FROM (
    SELECT CAST(target_data AS XML) AS target_data
    FROM sys.dm_xe_session_targets st
    JOIN sys.dm_xe_sessions s ON s.address = st.event_session_address
    WHERE s.name = 'system_health'
      AND st.target_name = 'ring_buffer'
) AS data
CROSS APPLY target_data.nodes('RingBufferTarget/event[@name="xml_deadlock_report"]') AS xev(xed)
WHERE xed.value('(@timestamp)[1]', 'DATETIMEOFFSET') > @since
ORDER BY deadlock_time_utc DESC
