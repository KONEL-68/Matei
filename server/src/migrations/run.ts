import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigrations(): Promise<void> {
  const config = loadConfig();
  const client = new pg.Client({
    host: config.pg.host,
    port: config.pg.port,
    user: config.pg.user,
    password: config.pg.password,
    database: config.pg.database,
  });

  await client.connect();
  console.log('Connected to PostgreSQL');

  try {
    // Ensure schema_migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Find all .sql migration files, sorted by name
    const files = fs
      .readdirSync(__dirname)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const version = file.replace('.sql', '');

      // Check if already applied
      const result = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1',
        [version],
      );

      if (result.rows.length > 0) {
        console.log(`Skipping ${file} (already applied)`);
        continue;
      }

      console.log(`Applying ${file}...`);
      const sql = fs.readFileSync(path.join(__dirname, file), 'utf-8');
      await client.query(sql);

      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version],
      );
      console.log(`Applied ${file}`);
    }

    console.log('All migrations complete');
  } finally {
    await client.end();
  }
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
