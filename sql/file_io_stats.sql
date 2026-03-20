-- Metric: File I/O Stats (per database file)
-- Source: sys.dm_io_virtual_file_stats
-- Frequency: 30 seconds
-- Aggregation: DELTA (cumulative counters — same logic as wait stats)
-- Docs: https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-views/sys-dm-io-virtual-file-stats-transact-sql
--
-- IMPORTANT: Values are cumulative since SQL Server start.
-- Collector must compute deltas the same way as wait_stats:
--   read_bytes_per_sec = (curr.num_of_bytes_read - prev.num_of_bytes_read) / elapsed_seconds
--   read_latency_ms    = delta(io_stall_read_ms) / delta(num_of_reads)  [avg latency per read]
--
-- If sqlserver_start_time changed → skip delta (instance restarted)

SELECT
    DB_NAME(vfs.database_id)    AS database_name,
    mf.name                     AS file_name,
    mf.type_desc                AS file_type,       -- ROWS or LOG
    mf.physical_name,
    vfs.database_id,
    vfs.file_id,

    -- Read stats (cumulative)
    vfs.num_of_reads,
    vfs.num_of_bytes_read,
    vfs.io_stall_read_ms,

    -- Write stats (cumulative)
    vfs.num_of_writes,
    vfs.num_of_bytes_written,
    vfs.io_stall_write_ms,

    -- Total I/O stall
    vfs.io_stall,

    -- File size
    vfs.size_on_disk_bytes,

    GETUTCDATE()                AS collected_at_utc
FROM sys.dm_io_virtual_file_stats(NULL, NULL) vfs
JOIN sys.master_files mf
    ON vfs.database_id = mf.database_id
    AND vfs.file_id = mf.file_id
ORDER BY vfs.io_stall DESC;
