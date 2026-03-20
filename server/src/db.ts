import pg from 'pg';
import type { AppConfig } from './config.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(config: AppConfig): pg.Pool {
  if (!pool) {
    pool = new Pool({
      host: config.pg.host,
      port: config.pg.port,
      user: config.pg.user,
      password: config.pg.password,
      database: config.pg.database,
      connectionTimeoutMillis: config.pg.connectionTimeoutMillis,
      idleTimeoutMillis: config.pg.idleTimeoutMillis,
      max: config.pg.max,
    });

    pool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err);
    });
  }
  return pool;
}

export async function checkConnection(pool: pg.Pool): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
