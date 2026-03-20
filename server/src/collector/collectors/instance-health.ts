import type sql from 'mssql';

export interface InstanceHealthRow {
  instance_name: string;
  edition: string;
  version: string;
  sp_level: string;
  major_version: number;
  hadr_enabled: boolean;
  is_clustered: boolean;
  sqlserver_start_time: Date;
  uptime_seconds: number;
  cpu_count: number;
  hyperthread_ratio: number;
  physical_memory_mb: number;
  committed_mb: number;
  target_mb: number;
  max_workers_count: number;
  scheduler_count: number;
  collected_at_utc: Date;
}

const QUERY = `
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
FROM sys.dm_os_sys_info si
`;

export async function collectInstanceHealth(request: sql.Request): Promise<InstanceHealthRow[]> {
  const result = await request.query(QUERY);
  return result.recordset as InstanceHealthRow[];
}
