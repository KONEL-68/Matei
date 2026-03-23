import sql from 'mssql';
import { decrypt } from './crypto.js';

export interface InstanceRecord {
  id: number;
  host: string;
  port: number;
  auth_type: 'sql' | 'windows';
  encrypted_credentials: string | null;
}

export interface DecryptedCredentials {
  username: string;
  password: string;
}

function decryptCredentials(encrypted: string, encryptionKey: string): DecryptedCredentials {
  const json = decrypt(encrypted, encryptionKey);
  return JSON.parse(json) as DecryptedCredentials;
}

export function buildConnectionConfig(instance: InstanceRecord, encryptionKey: string): sql.config {
  const config: sql.config = {
    server: instance.host,
    port: instance.port,
    options: {
      encrypt: true,
      trustServerCertificate: true,
      connectTimeout: 5000,
      requestTimeout: 10000,
      appName: 'Matei Monitor',
    },
  };

  if (instance.encrypted_credentials) {
    const creds = decryptCredentials(instance.encrypted_credentials, encryptionKey);
    config.user = creds.username;
    config.password = creds.password;
  }

  if (instance.auth_type === 'windows') {
    config.options!.trustedConnection = true;
  }

  return config;
}

export async function testConnection(
  config: sql.config,
): Promise<{ ok: true; result: sql.IRecordSet<Record<string, unknown>> } | { ok: false; error: string }> {
  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await new sql.ConnectionPool(config).connect();
    await pool.request().query('SELECT 1 AS ok');
    // Run instance_health query
    const healthResult = await pool.request().query(`
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
        si.physical_memory_kb / 1024        AS physical_memory_mb,
        GETUTCDATE()                        AS collected_at_utc
      FROM sys.dm_os_sys_info si
    `);
    return { ok: true, result: healthResult.recordset };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    if (pool) {
      try { await pool.close(); } catch { /* ignore close errors */ }
    }
  }
}
