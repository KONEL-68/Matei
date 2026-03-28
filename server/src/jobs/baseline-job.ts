import type pg from 'pg';

export interface BaselineJobLog {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const METRICS = ['cpu', 'memory', 'waits', 'disk_io'] as const;
type MetricName = (typeof METRICS)[number];

/**
 * Compute baseline for a single metric across all instances.
 * Uses last 7 days of hourly data to compute min/avg/max per hour-of-day.
 * Results are UPSERTed into overview_baseline.
 */
async function computeMetricBaseline(
  pool: pg.Pool,
  metric: MetricName,
  log: BaselineJobLog,
): Promise<number> {
  let query: string;

  switch (metric) {
    case 'cpu':
      query = `
        INSERT INTO overview_baseline (instance_id, metric, hour_of_day, baseline_min, baseline_avg, baseline_max, computed_at)
        SELECT instance_id, 'cpu',
               EXTRACT(HOUR FROM bucket AT TIME ZONE 'UTC')::int AS hour_of_day,
               MIN(avg_sql_cpu_pct) AS baseline_min,
               AVG(avg_sql_cpu_pct) AS baseline_avg,
               MAX(max_sql_cpu_pct) AS baseline_max,
               NOW() AS computed_at
        FROM os_cpu_hourly
        WHERE bucket >= NOW() - INTERVAL '7 days'
        GROUP BY instance_id, hour_of_day
        ON CONFLICT (instance_id, metric, hour_of_day)
        DO UPDATE SET
          baseline_min = EXCLUDED.baseline_min,
          baseline_avg = EXCLUDED.baseline_avg,
          baseline_max = EXCLUDED.baseline_max,
          computed_at = EXCLUDED.computed_at`;
      break;

    case 'memory':
      query = `
        INSERT INTO overview_baseline (instance_id, metric, hour_of_day, baseline_min, baseline_avg, baseline_max, computed_at)
        SELECT instance_id, 'memory',
               EXTRACT(HOUR FROM bucket AT TIME ZONE 'UTC')::int AS hour_of_day,
               MIN(avg_sql_committed_mb) / 1024.0 AS baseline_min,
               AVG(avg_sql_committed_mb) / 1024.0 AS baseline_avg,
               MAX(max_sql_committed_mb) / 1024.0 AS baseline_max,
               NOW() AS computed_at
        FROM os_memory_hourly
        WHERE bucket >= NOW() - INTERVAL '7 days'
        GROUP BY instance_id, hour_of_day
        ON CONFLICT (instance_id, metric, hour_of_day)
        DO UPDATE SET
          baseline_min = EXCLUDED.baseline_min,
          baseline_avg = EXCLUDED.baseline_avg,
          baseline_max = EXCLUDED.baseline_max,
          computed_at = EXCLUDED.computed_at`;
      break;

    case 'waits':
      query = `
        INSERT INTO overview_baseline (instance_id, metric, hour_of_day, baseline_min, baseline_avg, baseline_max, computed_at)
        WITH hourly_totals AS (
          SELECT instance_id, bucket,
                 EXTRACT(HOUR FROM bucket AT TIME ZONE 'UTC')::int AS hour_of_day,
                 SUM(avg_wait_ms_per_sec) AS total_wait
          FROM wait_stats_hourly
          WHERE bucket >= NOW() - INTERVAL '7 days'
          GROUP BY instance_id, bucket
        )
        SELECT instance_id, 'waits',
               hour_of_day,
               MIN(total_wait) AS baseline_min,
               AVG(total_wait) AS baseline_avg,
               MAX(total_wait) AS baseline_max,
               NOW() AS computed_at
        FROM hourly_totals
        GROUP BY instance_id, hour_of_day
        ON CONFLICT (instance_id, metric, hour_of_day)
        DO UPDATE SET
          baseline_min = EXCLUDED.baseline_min,
          baseline_avg = EXCLUDED.baseline_avg,
          baseline_max = EXCLUDED.baseline_max,
          computed_at = EXCLUDED.computed_at`;
      break;

    case 'disk_io':
      // file_io_hourly has avg_read_latency_ms, avg_write_latency_ms, total_reads, total_writes
      // Use average combined latency (read + write) as the baseline metric
      query = `
        INSERT INTO overview_baseline (instance_id, metric, hour_of_day, baseline_min, baseline_avg, baseline_max, computed_at)
        WITH hourly_totals AS (
          SELECT instance_id, bucket,
                 EXTRACT(HOUR FROM bucket AT TIME ZONE 'UTC')::int AS hour_of_day,
                 AVG(avg_read_latency_ms + avg_write_latency_ms) AS combined_latency_ms
          FROM file_io_hourly
          WHERE bucket >= NOW() - INTERVAL '7 days'
          GROUP BY instance_id, bucket
        )
        SELECT instance_id, 'disk_io',
               hour_of_day,
               MIN(combined_latency_ms) AS baseline_min,
               AVG(combined_latency_ms) AS baseline_avg,
               MAX(combined_latency_ms) AS baseline_max,
               NOW() AS computed_at
        FROM hourly_totals
        GROUP BY instance_id, hour_of_day
        ON CONFLICT (instance_id, metric, hour_of_day)
        DO UPDATE SET
          baseline_min = EXCLUDED.baseline_min,
          baseline_avg = EXCLUDED.baseline_avg,
          baseline_max = EXCLUDED.baseline_max,
          computed_at = EXCLUDED.computed_at`;
      break;
  }

  try {
    const result = await pool.query(query);
    return result.rowCount ?? 0;
  } catch (err) {
    log.error(`Baseline computation failed for metric=${metric}: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

/**
 * Run baseline computation for all metrics.
 */
export async function runBaselineComputation(pool: pg.Pool, log: BaselineJobLog): Promise<void> {
  log.info('Baseline computation starting');
  let total = 0;

  for (const metric of METRICS) {
    const rows = await computeMetricBaseline(pool, metric, log);
    total += rows;
  }

  log.info(`Baseline computation complete: ${total} rows upserted`);
}

/**
 * Start the baseline job — runs immediately on startup, then every 6 hours.
 */
export function startBaselineJob(pool: pg.Pool, log: BaselineJobLog): NodeJS.Timeout {
  // Run immediately on startup
  runBaselineComputation(pool, log).catch((err) => {
    log.error(`Baseline computation failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  // Then every 6 hours
  return setInterval(() => {
    runBaselineComputation(pool, log).catch((err) => {
      log.error(`Baseline computation failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, 6 * 3600_000);
}
