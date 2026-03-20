-- Metric: Disk Space (per volume where SQL Server has files)
-- Source: sys.dm_os_volume_stats + sys.master_files
-- Frequency: 5 minutes (disk space doesn't change fast)
-- Aggregation: snapshot
-- Docs: https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-views/sys-dm-os-volume-stats-transact-sql
--
-- NOTE: Only shows volumes that have SQL Server database files on them.
-- This is exactly what we want — we monitor storage relevant to SQL Server.

SELECT DISTINCT
    vs.volume_mount_point,
    vs.logical_volume_name,
    vs.file_system_type,
    vs.total_bytes / 1048576                         AS total_mb,
    vs.available_bytes / 1048576                     AS available_mb,
    (vs.total_bytes - vs.available_bytes) / 1048576  AS used_mb,
    CAST(100.0 * (vs.total_bytes - vs.available_bytes)
        / NULLIF(vs.total_bytes, 0) AS DECIMAL(5,2)) AS used_pct,
    vs.supports_compression,
    vs.is_compressed,
    GETUTCDATE()                                     AS collected_at_utc
FROM sys.master_files mf
CROSS APPLY sys.dm_os_volume_stats(mf.database_id, mf.file_id) vs;
