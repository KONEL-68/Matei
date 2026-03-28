-- Database properties, files, and VLF counts
-- Source: sys.databases, sys.master_files, sys.dm_db_log_info, msdb.dbo.backupset
-- Collection frequency: 5min (every 10th cycle)
-- Type: snapshot (full replace per instance)
-- Validation: SELECT d.name, d.state_desc, d.recovery_model_desc FROM sys.databases

-- Database properties
SELECT
    d.name AS database_name,
    d.state_desc,
    d.recovery_model_desc,
    d.compatibility_level,
    d.collation_name,
    SUSER_SNAME(d.owner_sid) AS owner_name,
    d.create_date,
    (SELECT MAX(bs.backup_finish_date)
     FROM msdb.dbo.backupset bs
     WHERE bs.database_name = d.name AND bs.type = 'D') AS last_full_backup,
    (SELECT MAX(bs.backup_finish_date)
     FROM msdb.dbo.backupset bs
     WHERE bs.database_name = d.name AND bs.type = 'L') AS last_log_backup
FROM sys.databases d;

-- Database files (from master context — no USE required)
SELECT
    DB_NAME(mf.database_id) AS database_name,
    mf.name AS file_name,
    mf.type_desc,
    fg.name AS filegroup_name,
    mf.physical_name,
    mf.size * 8 / 1024.0 AS size_mb,
    mf.max_size,
    mf.growth,
    mf.is_percent_growth
FROM sys.master_files mf
LEFT JOIN sys.filegroups fg ON mf.data_space_id = fg.data_space_id
    AND mf.database_id = DB_ID()
ORDER BY mf.database_id, mf.type, mf.file_id;

-- VLF count per database (SQL Server 2016 SP2+)
-- Must be called per database: SELECT COUNT(*) FROM sys.dm_db_log_info(DB_ID('dbname'))
