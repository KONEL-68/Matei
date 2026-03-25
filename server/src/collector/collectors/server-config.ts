import type sql from 'mssql';

export interface ServerConfigRow {
  server_collation: string | null;
  xp_cmdshell: number | null;
  clr_enabled: number | null;
  external_scripts_enabled: number | null;
  remote_access: number | null;
  max_degree_of_parallelism: number | null;
  max_server_memory_mb: number | null;
  cost_threshold_for_parallelism: number | null;
}

const QUERY = `
SELECT
    SERVERPROPERTY('Collation') AS server_collation,
    c_xp.value_in_use AS xp_cmdshell,
    c_clr.value_in_use AS clr_enabled,
    c_ext.value_in_use AS external_scripts_enabled,
    c_remote.value_in_use AS remote_access,
    c_maxdop.value_in_use AS max_degree_of_parallelism,
    c_maxmem.value_in_use AS max_server_memory_mb,
    c_cost.value_in_use AS cost_threshold_for_parallelism
FROM (SELECT 1 AS dummy) d
LEFT JOIN sys.configurations c_xp ON c_xp.name = 'xp_cmdshell'
LEFT JOIN sys.configurations c_clr ON c_clr.name = 'clr enabled'
LEFT JOIN sys.configurations c_ext ON c_ext.name = 'external scripts enabled'
LEFT JOIN sys.configurations c_remote ON c_remote.name = 'remote access'
LEFT JOIN sys.configurations c_maxdop ON c_maxdop.name = 'max degree of parallelism'
LEFT JOIN sys.configurations c_maxmem ON c_maxmem.name = 'max server memory (MB)'
LEFT JOIN sys.configurations c_cost ON c_cost.name = 'cost threshold for parallelism'
`;

export async function collectServerConfig(request: sql.Request): Promise<ServerConfigRow[]> {
  const result = await request.query(QUERY);
  return result.recordset as ServerConfigRow[];
}
