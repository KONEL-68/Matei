import type sql from 'mssql';

export interface OsDiskRow {
  volume_mount_point: string;
  logical_volume_name: string;
  file_system_type: string;
  total_mb: number;
  available_mb: number;
  used_mb: number;
  used_pct: number;
  supports_compression: boolean;
  is_compressed: boolean;
  collected_at_utc: Date;
}

const QUERY = `
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
CROSS APPLY sys.dm_os_volume_stats(mf.database_id, mf.file_id) vs
`;

export async function collectOsDisk(request: sql.Request): Promise<OsDiskRow[]> {
  const result = await request.query(QUERY);
  return result.recordset as OsDiskRow[];
}
