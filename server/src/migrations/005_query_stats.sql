-- Migration 005: Query stats raw table
-- Stores per-second rate deltas from sys.dm_exec_query_stats

CREATE TABLE IF NOT EXISTS query_stats_raw (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id             INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    query_hash              VARCHAR(100) NOT NULL,
    statement_text          TEXT,
    database_name           VARCHAR(255),
    execution_count_delta   BIGINT,
    cpu_ms_per_sec          DOUBLE PRECISION,
    elapsed_ms_per_sec      DOUBLE PRECISION,
    reads_per_sec           DOUBLE PRECISION,
    writes_per_sec          DOUBLE PRECISION,
    rows_per_sec            DOUBLE PRECISION,
    avg_cpu_ms              DOUBLE PRECISION,
    avg_elapsed_ms          DOUBLE PRECISION,
    avg_reads               DOUBLE PRECISION,
    avg_writes              DOUBLE PRECISION,
    collected_at            TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (collected_at);

-- Create initial daily partitions
SELECT create_daily_partitions('query_stats_raw');
