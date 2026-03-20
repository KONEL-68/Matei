import dotenv from 'dotenv';

dotenv.config({ path: '../docker/.env' });

export interface AppConfig {
  nodeEnv: string;
  apiPort: number;
  pg: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    connectionTimeoutMillis: number;
    idleTimeoutMillis: number;
    max: number;
  };
  encryptionKey: string;
  collector: {
    intervalMs: number;
    workers: number;
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function loadConfig(): AppConfig {
  return {
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    apiPort: parseInt(optionalEnv('API_PORT', '3001'), 10),
    pg: {
      host: optionalEnv('PGHOST', 'localhost'),
      port: parseInt(optionalEnv('PGPORT', '5432'), 10),
      user: optionalEnv('PGUSER', 'matei'),
      password: optionalEnv('PGPASSWORD', 'matei_dev'),
      database: optionalEnv('PGDATABASE', 'matei'),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 20,
    },
    encryptionKey: requiredEnv('ENCRYPTION_KEY'),
    collector: {
      intervalMs: parseInt(optionalEnv('COLLECTOR_INTERVAL_MS', '30000'), 10),
      workers: parseInt(optionalEnv('COLLECTOR_WORKERS', '40'), 10),
    },
  };
}
