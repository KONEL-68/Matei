import type sql from 'mssql';

export interface OsHostInfoRow {
  host_platform: string;
  host_distribution: string;
  host_release: string;
  host_service_pack_level: string;
  host_sku: number;
  os_language_version: number;
  collected_at_utc: Date;
}

const QUERY = `
SELECT
    host_platform,
    host_distribution,
    host_release,
    host_service_pack_level,
    host_sku,
    os_language_version,
    GETUTCDATE() AS collected_at_utc
FROM sys.dm_os_host_info
`;

export async function collectOsHostInfo(request: sql.Request): Promise<OsHostInfoRow[]> {
  const result = await request.query(QUERY);
  return result.recordset as OsHostInfoRow[];
}
