ALTER TABLE query_stats_raw ADD COLUMN IF NOT EXISTS avg_physical_reads DOUBLE PRECISION;
ALTER TABLE query_stats_raw ADD COLUMN IF NOT EXISTS physical_reads_per_sec DOUBLE PRECISION;
