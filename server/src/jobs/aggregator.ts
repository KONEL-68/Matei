import type pg from 'pg';

export interface AggregatorLog {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * Compute a 5-minute aggregation bucket start for a given timestamp.
 * Exported for testing.
 */
export function fiveMinBucket(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5);
  return d;
}

/**
 * Compute an hourly aggregation bucket start for a given timestamp.
 * Exported for testing.
 */
export function hourlyBucket(date: Date): Date {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d;
}

/**
 * Aggregate raw wait stats → 5-minute rollups.
 * Returns number of rows inserted.
 */
export async function aggregateWaitStats5min(pool: pg.Pool, windowStart: Date, windowEnd: Date): Promise<number> {
  const result = await pool.query(
    `INSERT INTO wait_stats_5min (instance_id, bucket, wait_type, avg_wait_ms_per_sec, max_wait_ms_per_sec, total_wait_time_ms, sample_count)
     SELECT
       instance_id,
       date_trunc('minute', collected_at) - (EXTRACT(MINUTE FROM collected_at)::int % 5) * INTERVAL '1 minute' AS bucket,
       wait_type,
       AVG(wait_time_ms_delta::float / 30) AS avg_wait_ms_per_sec,
       MAX(wait_time_ms_delta::float / 30) AS max_wait_ms_per_sec,
       SUM(wait_time_ms_delta) AS total_wait_time_ms,
       COUNT(*) AS sample_count
     FROM wait_stats_raw
     WHERE collected_at >= $1 AND collected_at < $2
     GROUP BY instance_id, bucket, wait_type
     ON CONFLICT DO NOTHING`,
    [windowStart, windowEnd],
  );
  return result.rowCount ?? 0;
}

/**
 * Aggregate raw CPU → 5-minute rollups.
 */
export async function aggregateCpu5min(pool: pg.Pool, windowStart: Date, windowEnd: Date): Promise<number> {
  const result = await pool.query(
    `INSERT INTO os_cpu_5min (instance_id, bucket, avg_sql_cpu_pct, max_sql_cpu_pct, avg_system_idle_pct, sample_count)
     SELECT
       instance_id,
       date_trunc('minute', collected_at) - (EXTRACT(MINUTE FROM collected_at)::int % 5) * INTERVAL '1 minute' AS bucket,
       AVG(sql_cpu_pct) AS avg_sql_cpu_pct,
       MAX(sql_cpu_pct) AS max_sql_cpu_pct,
       AVG(system_idle_pct) AS avg_system_idle_pct,
       COUNT(*) AS sample_count
     FROM os_cpu
     WHERE collected_at >= $1 AND collected_at < $2
     GROUP BY instance_id, bucket
     ON CONFLICT DO NOTHING`,
    [windowStart, windowEnd],
  );
  return result.rowCount ?? 0;
}

/**
 * Aggregate raw memory → 5-minute rollups.
 */
export async function aggregateMemory5min(pool: pg.Pool, windowStart: Date, windowEnd: Date): Promise<number> {
  const result = await pool.query(
    `INSERT INTO os_memory_5min (instance_id, bucket, avg_available_memory_mb, min_available_memory_mb, avg_sql_committed_mb, max_sql_committed_mb, sample_count)
     SELECT
       instance_id,
       date_trunc('minute', collected_at) - (EXTRACT(MINUTE FROM collected_at)::int % 5) * INTERVAL '1 minute' AS bucket,
       AVG(os_available_memory_mb) AS avg_available_memory_mb,
       MIN(os_available_memory_mb) AS min_available_memory_mb,
       AVG(sql_committed_mb) AS avg_sql_committed_mb,
       MAX(sql_committed_mb) AS max_sql_committed_mb,
       COUNT(*) AS sample_count
     FROM os_memory
     WHERE collected_at >= $1 AND collected_at < $2
     GROUP BY instance_id, bucket
     ON CONFLICT DO NOTHING`,
    [windowStart, windowEnd],
  );
  return result.rowCount ?? 0;
}

/**
 * Aggregate raw file I/O → 5-minute rollups.
 */
export async function aggregateFileIo5min(pool: pg.Pool, windowStart: Date, windowEnd: Date): Promise<number> {
  const result = await pool.query(
    `INSERT INTO file_io_5min (instance_id, bucket, database_name, file_name,
       avg_read_latency_ms, max_read_latency_ms, avg_write_latency_ms, max_write_latency_ms,
       total_reads, total_writes, sample_count)
     SELECT
       instance_id,
       date_trunc('minute', collected_at) - (EXTRACT(MINUTE FROM collected_at)::int % 5) * INTERVAL '1 minute' AS bucket,
       database_name,
       file_name,
       AVG(CASE WHEN num_of_reads_delta > 0 THEN io_stall_read_ms_delta::float / num_of_reads_delta ELSE 0 END) AS avg_read_latency_ms,
       MAX(CASE WHEN num_of_reads_delta > 0 THEN io_stall_read_ms_delta::float / num_of_reads_delta ELSE 0 END) AS max_read_latency_ms,
       AVG(CASE WHEN num_of_writes_delta > 0 THEN io_stall_write_ms_delta::float / num_of_writes_delta ELSE 0 END) AS avg_write_latency_ms,
       MAX(CASE WHEN num_of_writes_delta > 0 THEN io_stall_write_ms_delta::float / num_of_writes_delta ELSE 0 END) AS max_write_latency_ms,
       SUM(num_of_reads_delta) AS total_reads,
       SUM(num_of_writes_delta) AS total_writes,
       COUNT(*) AS sample_count
     FROM file_io_stats
     WHERE collected_at >= $1 AND collected_at < $2
     GROUP BY instance_id, bucket, database_name, file_name
     ON CONFLICT DO NOTHING`,
    [windowStart, windowEnd],
  );
  return result.rowCount ?? 0;
}

/**
 * Aggregate 5-minute → hourly rollups.
 */
export async function aggregateHourly(pool: pg.Pool, windowStart: Date, windowEnd: Date, log: AggregatorLog): Promise<number> {
  let total = 0;

  // Wait stats
  try {
    const r = await pool.query(
      `INSERT INTO wait_stats_hourly (instance_id, bucket, wait_type, avg_wait_ms_per_sec, max_wait_ms_per_sec, total_wait_time_ms, sample_count)
       SELECT instance_id, date_trunc('hour', bucket) AS bucket, wait_type,
         AVG(avg_wait_ms_per_sec), MAX(max_wait_ms_per_sec), SUM(total_wait_time_ms), SUM(sample_count)
       FROM wait_stats_5min
       WHERE bucket >= $1 AND bucket < $2
       GROUP BY instance_id, date_trunc('hour', bucket), wait_type
       ON CONFLICT DO NOTHING`,
      [windowStart, windowEnd],
    );
    total += r.rowCount ?? 0;
  } catch (err) {
    log.error(`Hourly wait_stats aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // CPU
  try {
    const r = await pool.query(
      `INSERT INTO os_cpu_hourly (instance_id, bucket, avg_sql_cpu_pct, max_sql_cpu_pct, avg_system_idle_pct, sample_count)
       SELECT instance_id, date_trunc('hour', bucket) AS bucket,
         AVG(avg_sql_cpu_pct), MAX(max_sql_cpu_pct), AVG(avg_system_idle_pct), SUM(sample_count)
       FROM os_cpu_5min
       WHERE bucket >= $1 AND bucket < $2
       GROUP BY instance_id, date_trunc('hour', bucket)
       ON CONFLICT DO NOTHING`,
      [windowStart, windowEnd],
    );
    total += r.rowCount ?? 0;
  } catch (err) {
    log.error(`Hourly os_cpu aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Memory
  try {
    const r = await pool.query(
      `INSERT INTO os_memory_hourly (instance_id, bucket, avg_available_memory_mb, min_available_memory_mb, avg_sql_committed_mb, max_sql_committed_mb, sample_count)
       SELECT instance_id, date_trunc('hour', bucket) AS bucket,
         AVG(avg_available_memory_mb), MIN(min_available_memory_mb), AVG(avg_sql_committed_mb), MAX(max_sql_committed_mb), SUM(sample_count)
       FROM os_memory_5min
       WHERE bucket >= $1 AND bucket < $2
       GROUP BY instance_id, date_trunc('hour', bucket)
       ON CONFLICT DO NOTHING`,
      [windowStart, windowEnd],
    );
    total += r.rowCount ?? 0;
  } catch (err) {
    log.error(`Hourly os_memory aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // File I/O
  try {
    const r = await pool.query(
      `INSERT INTO file_io_hourly (instance_id, bucket, database_name, file_name,
         avg_read_latency_ms, max_read_latency_ms, avg_write_latency_ms, max_write_latency_ms,
         total_reads, total_writes, sample_count)
       SELECT instance_id, date_trunc('hour', bucket) AS bucket, database_name, file_name,
         AVG(avg_read_latency_ms), MAX(max_read_latency_ms), AVG(avg_write_latency_ms), MAX(max_write_latency_ms),
         SUM(total_reads), SUM(total_writes), SUM(sample_count)
       FROM file_io_5min
       WHERE bucket >= $1 AND bucket < $2
       GROUP BY instance_id, date_trunc('hour', bucket), database_name, file_name
       ON CONFLICT DO NOTHING`,
      [windowStart, windowEnd],
    );
    total += r.rowCount ?? 0;
  } catch (err) {
    log.error(`Hourly file_io aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return total;
}

/**
 * Run 5-minute aggregation for the most recent complete 5-min window.
 */
export async function runFiveMinAggregation(pool: pg.Pool, log: AggregatorLog): Promise<void> {
  const now = new Date();
  const windowEnd = fiveMinBucket(now);
  const windowStart = new Date(windowEnd.getTime() - 5 * 60_000);

  let total = 0;
  try { total += await aggregateWaitStats5min(pool, windowStart, windowEnd); } catch (err) {
    log.error(`5min wait_stats aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  try { total += await aggregateCpu5min(pool, windowStart, windowEnd); } catch (err) {
    log.error(`5min os_cpu aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  try { total += await aggregateMemory5min(pool, windowStart, windowEnd); } catch (err) {
    log.error(`5min os_memory aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  try { total += await aggregateFileIo5min(pool, windowStart, windowEnd); } catch (err) {
    log.error(`5min file_io aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (total > 0) {
    log.info(`5min aggregation: ${total} rows (${windowStart.toISOString()} → ${windowEnd.toISOString()})`);
  }
}

/**
 * Run hourly aggregation for the most recent complete hour.
 */
export async function runHourlyAggregation(pool: pg.Pool, log: AggregatorLog): Promise<void> {
  const now = new Date();
  const windowEnd = hourlyBucket(now);
  const windowStart = new Date(windowEnd.getTime() - 3600_000);

  const total = await aggregateHourly(pool, windowStart, windowEnd, log);
  if (total > 0) {
    log.info(`Hourly aggregation: ${total} rows (${windowStart.toISOString()} → ${windowEnd.toISOString()})`);
  }
}

let lastHourlyRun = 0;

/**
 * Start the aggregator — runs 5-min aggregation every 5 minutes,
 * hourly aggregation every hour.
 */
export function startAggregator(pool: pg.Pool, log: AggregatorLog): NodeJS.Timeout {
  return setInterval(() => {
    runFiveMinAggregation(pool, log).catch((err) => {
      log.error(`5min aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    // Run hourly aggregation once per hour
    const nowHour = new Date().getHours();
    if (nowHour !== lastHourlyRun) {
      lastHourlyRun = nowHour;
      runHourlyAggregation(pool, log).catch((err) => {
        log.error(`Hourly aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }, 5 * 60_000);
}
