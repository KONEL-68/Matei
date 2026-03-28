import type sql from 'mssql';

export interface DatabasePropertyRow {
  database_name: string;
  state_desc: string;
  recovery_model_desc: string;
  compatibility_level: number;
  collation_name: string | null;
  owner_name: string | null;
  create_date: Date | null;
  last_full_backup: Date | null;
  last_log_backup: Date | null;
  vlf_count: number | null;
}

export interface DatabaseFileRow {
  database_name: string;
  file_name: string;
  type_desc: string;
  filegroup_name: string | null;
  physical_name: string;
  size_mb: number;
  used_mb: number | null;
  max_size: number;
  growth: number;
  is_percent_growth: boolean;
}

const PROPERTIES_QUERY = `
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
FROM sys.databases d
`;

const FILES_QUERY = `
SELECT
    DB_NAME(mf.database_id) AS database_name,
    mf.name AS file_name,
    mf.type_desc,
    NULL AS filegroup_name,
    mf.physical_name,
    mf.size * 8 / 1024.0 AS size_mb,
    mf.max_size,
    mf.growth,
    mf.is_percent_growth
FROM sys.master_files mf
ORDER BY mf.database_id, mf.type, mf.file_id
`;

export interface DatabasePropertiesResult {
  properties: DatabasePropertyRow[];
  files: DatabaseFileRow[];
}

/**
 * Collect database properties, files, and VLF counts.
 * VLF counts are collected per-database via dm_db_log_info (SQL 2016 SP2+).
 */
export async function collectDatabaseProperties(
  request: sql.Request,
): Promise<DatabasePropertiesResult> {
  const [propsResult, filesResult] = await Promise.all([
    request.query(PROPERTIES_QUERY),
    request.query(FILES_QUERY),
  ]);

  const properties = propsResult.recordset as DatabasePropertyRow[];
  const files = filesResult.recordset as DatabaseFileRow[];

  // Initialize used_mb to null for all files
  for (const f of files) {
    f.used_mb = null;
  }

  // Collect used space per online database via FILEPROPERTY (non-fatal per database)
  const onlineDbs = new Set(
    properties.filter(p => p.state_desc === 'ONLINE').map(p => p.database_name),
  );
  for (const dbName of onlineDbs) {
    try {
      const safeName = dbName.replace(/]/g, ']]');
      const usedResult = await request.query(
        `SELECT file_id, name, FILEPROPERTY(name, 'SpaceUsed') AS pages_used FROM [${safeName}].sys.database_files`,
      );
      for (const row of usedResult.recordset) {
        const file = files.find(f => f.database_name === dbName && f.file_name === row.name);
        if (file && row.pages_used != null) {
          file.used_mb = (row.pages_used * 8) / 1024.0;
        }
      }
    } catch {
      // Permission denied or database not accessible — leave used_mb as null
    }
  }

  // Collect VLF counts per online database (non-fatal per database)
  for (const prop of properties) {
    if (prop.state_desc !== 'ONLINE') continue;
    try {
      const vlfResult = await request.query(
        `SELECT COUNT(*) AS vlf_count FROM sys.dm_db_log_info(DB_ID('${prop.database_name.replace(/'/g, "''")}'))`,
      );
      prop.vlf_count = vlfResult.recordset[0]?.vlf_count ?? null;
    } catch {
      // dm_db_log_info not available on older SQL Server versions
      prop.vlf_count = null;
    }
  }

  return { properties, files };
}
