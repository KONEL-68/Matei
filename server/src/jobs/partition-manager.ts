import type pg from 'pg';

export interface PartitionManagerLog {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/** Tables partitioned by day (raw metrics). */
const RAW_TABLES = [
  'instance_health',
  'wait_stats_raw',
  'active_sessions_snapshot',
  'os_cpu',
  'os_memory',
  'os_disk',
  'file_io_stats',
  'perf_counters_raw',
];

/** Tables partitioned by month (aggregation rollups). */
const MONTHLY_TABLES_5MIN = [
  'wait_stats_5min',
  'os_cpu_5min',
  'os_memory_5min',
  'file_io_5min',
];

const MONTHLY_TABLES_HOURLY = [
  'wait_stats_hourly',
  'os_cpu_hourly',
  'os_memory_hourly',
  'file_io_hourly',
];

/** Retention periods in days. */
const RETENTION = {
  raw: 7,
  alerts: 90,
  fiveMin: 30,
  hourly: 365,
} as const;

/**
 * Generate partition name and bounds for a daily partition.
 * Exported for testing.
 */
export function dailyPartitionInfo(tableName: string, date: Date): {
  partitionName: string;
  startDate: string;
  endDate: string;
} {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const partitionName = `${tableName}_${y}${m}${d}`;
  const startDate = `${y}-${m}-${d}`;
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  const ny = nextDay.getFullYear();
  const nm = String(nextDay.getMonth() + 1).padStart(2, '0');
  const nd = String(nextDay.getDate()).padStart(2, '0');
  const endDate = `${ny}-${nm}-${nd}`;
  return { partitionName, startDate, endDate };
}

/**
 * Generate partition name and bounds for a monthly partition.
 * Exported for testing.
 */
export function monthlyPartitionInfo(tableName: string, date: Date): {
  partitionName: string;
  startDate: string;
  endDate: string;
} {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const partitionName = `${tableName}_${y}${m}`;
  const startDate = `${y}-${m}-01`;
  const nextMonth = new Date(y, date.getMonth() + 1, 1);
  const ny = nextMonth.getFullYear();
  const nm = String(nextMonth.getMonth() + 1).padStart(2, '0');
  const endDate = `${ny}-${nm}-01`;
  return { partitionName, startDate, endDate };
}

/**
 * Build the DROP TABLE statement for a partition older than retention.
 * Exported for testing.
 */
export function buildDropStatement(partitionName: string): string {
  return `DROP TABLE IF EXISTS ${partitionName}`;
}

/**
 * Create daily partitions for the next N days for all raw tables.
 */
async function createDailyPartitions(pool: pg.Pool, daysAhead: number, log: PartitionManagerLog): Promise<number> {
  let created = 0;
  const now = new Date();

  for (const table of RAW_TABLES) {
    for (let i = 0; i <= daysAhead; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);
      const { partitionName, startDate, endDate } = dailyPartitionInfo(table, date);

      try {
        // Check if partition exists
        const exists = await pool.query(
          `SELECT 1 FROM pg_class WHERE relname = $1`,
          [partitionName],
        );
        if (exists.rows.length > 0) continue;

        await pool.query(
          `CREATE TABLE ${partitionName} PARTITION OF ${table} FOR VALUES FROM ('${startDate}') TO ('${endDate}')`,
        );
        log.info(`Created partition ${partitionName}`);
        created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Partition may already exist from concurrent creation
        if (!msg.includes('already exists')) {
          log.error(`Failed to create partition ${partitionName}: ${msg}`);
        }
      }
    }
  }

  return created;
}

/**
 * Create monthly partitions for the next N months for aggregation tables.
 */
async function createMonthlyPartitions(pool: pg.Pool, monthsAhead: number, log: PartitionManagerLog): Promise<number> {
  let created = 0;
  const now = new Date();
  const tables = [...MONTHLY_TABLES_5MIN, ...MONTHLY_TABLES_HOURLY];

  for (const table of tables) {
    for (let i = 0; i <= monthsAhead; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const { partitionName, startDate, endDate } = monthlyPartitionInfo(table, date);

      try {
        const exists = await pool.query(
          `SELECT 1 FROM pg_class WHERE relname = $1`,
          [partitionName],
        );
        if (exists.rows.length > 0) continue;

        await pool.query(
          `CREATE TABLE ${partitionName} PARTITION OF ${table} FOR VALUES FROM ('${startDate}') TO ('${endDate}')`,
        );
        log.info(`Created partition ${partitionName}`);
        created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('already exists')) {
          log.error(`Failed to create partition ${partitionName}: ${msg}`);
        }
      }
    }
  }

  return created;
}

/**
 * Drop daily partitions older than retention period.
 */
async function dropOldDailyPartitions(pool: pg.Pool, log: PartitionManagerLog): Promise<number> {
  let dropped = 0;

  for (const table of RAW_TABLES) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION.raw);

    const result = await pool.query(
      `SELECT c.relname
       FROM pg_class c
       JOIN pg_inherits i ON c.oid = i.inhrelid
       JOIN pg_class parent ON i.inhparent = parent.oid
       WHERE parent.relname = $1
       ORDER BY c.relname`,
      [table],
    );

    for (const row of result.rows) {
      // Extract date from partition name: table_YYYYMMDD
      const match = row.relname.match(/_(\d{8})$/);
      if (!match) continue;

      const dateStr = match[1];
      const partDate = new Date(
        parseInt(dateStr.slice(0, 4)),
        parseInt(dateStr.slice(4, 6)) - 1,
        parseInt(dateStr.slice(6, 8)),
      );

      if (partDate < cutoff) {
        try {
          await pool.query(buildDropStatement(row.relname));
          log.info(`Dropped partition ${row.relname}`);
          dropped++;
        } catch (err) {
          log.error(`Failed to drop partition ${row.relname}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  // Drop old alerts (not partitioned, just DELETE)
  try {
    const alertCutoff = new Date();
    alertCutoff.setDate(alertCutoff.getDate() - RETENTION.alerts);
    const result = await pool.query(
      `DELETE FROM alerts WHERE created_at < $1`,
      [alertCutoff],
    );
    if (result.rowCount && result.rowCount > 0) {
      log.info(`Deleted ${result.rowCount} alerts older than ${RETENTION.alerts} days`);
    }
  } catch (err) {
    log.error(`Failed to clean old alerts: ${err instanceof Error ? err.message : String(err)}`);
  }

  return dropped;
}

/**
 * Drop monthly partitions older than retention.
 */
async function dropOldMonthlyPartitions(pool: pg.Pool, log: PartitionManagerLog): Promise<number> {
  let dropped = 0;

  const tableRetention: Array<[string[], number]> = [
    [MONTHLY_TABLES_5MIN, RETENTION.fiveMin],
    [MONTHLY_TABLES_HOURLY, RETENTION.hourly],
  ];

  for (const [tables, retentionDays] of tableRetention) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    for (const table of tables) {
      const result = await pool.query(
        `SELECT c.relname
         FROM pg_class c
         JOIN pg_inherits i ON c.oid = i.inhrelid
         JOIN pg_class parent ON i.inhparent = parent.oid
         WHERE parent.relname = $1
         ORDER BY c.relname`,
        [table],
      );

      for (const row of result.rows) {
        const match = row.relname.match(/_(\d{6})$/);
        if (!match) continue;

        const dateStr = match[1];
        const partDate = new Date(
          parseInt(dateStr.slice(0, 4)),
          parseInt(dateStr.slice(4, 6)) - 1,
          1,
        );

        if (partDate < cutoff) {
          try {
            await pool.query(buildDropStatement(row.relname));
            log.info(`Dropped partition ${row.relname}`);
            dropped++;
          } catch (err) {
            log.error(`Failed to drop partition ${row.relname}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }
  }

  return dropped;
}

/**
 * Run full partition maintenance cycle.
 */
export async function runPartitionMaintenance(pool: pg.Pool, log: PartitionManagerLog): Promise<void> {
  log.info('Partition maintenance starting');
  const created = await createDailyPartitions(pool, 7, log);
  const monthlyCreated = await createMonthlyPartitions(pool, 3, log);
  const dropped = await dropOldDailyPartitions(pool, log);
  const monthlyDropped = await dropOldMonthlyPartitions(pool, log);
  log.info(`Partition maintenance complete: created=${created + monthlyCreated} dropped=${dropped + monthlyDropped}`);
}

/**
 * Start the partition manager — runs immediately, then every hour.
 */
export function startPartitionManager(pool: pg.Pool, log: PartitionManagerLog): NodeJS.Timeout {
  // Run immediately on startup
  runPartitionMaintenance(pool, log).catch((err) => {
    log.error(`Partition maintenance failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  // Then every hour
  return setInterval(() => {
    runPartitionMaintenance(pool, log).catch((err) => {
      log.error(`Partition maintenance failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, 3600_000);
}
