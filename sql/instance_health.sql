-- Metric: Instance Health
-- Source: SERVERPROPERTY() + sys.dm_os_sys_info
-- Frequency: 60 seconds
-- Aggregation: snapshot
-- Validation: run this query and compare with Matei dashboard

SELECT
    SERVERPROPERTY('ServerName')        AS instance_name,
    SERVERPROPERTY('Edition')           AS edition,
    SERVERPROPERTY('ProductVersion')    AS version,
    SERVERPROPERTY('ProductLevel')      AS sp_level,
    SERVERPROPERTY('ProductMajorVersion') AS major_version,
    SERVERPROPERTY('IsHadrEnabled')     AS hadr_enabled,
    SERVERPROPERTY('IsClustered')       AS is_clustered,
    si.sqlserver_start_time,
    DATEDIFF(SECOND, si.sqlserver_start_time, GETUTCDATE()) AS uptime_seconds,
    si.cpu_count,
    si.hyperthread_ratio,
    si.physical_memory_kb,
    si.physical_memory_kb / 1024        AS physical_memory_mb,
    si.committed_kb / 1024              AS committed_mb,
    si.committed_target_kb / 1024       AS target_mb,
    si.max_workers_count,
    si.scheduler_count,
    GETUTCDATE()                        AS collected_at_utc
FROM sys.dm_os_sys_info si;
