CREATE TABLE IF NOT EXISTS procedure_stats_raw (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id             INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    database_name           VARCHAR(255),
    procedure_name          VARCHAR(500) NOT NULL,
    execution_count_delta   BIGINT,
    cpu_ms_per_sec          DOUBLE PRECISION,
    elapsed_ms_per_sec      DOUBLE PRECISION,
    reads_per_sec           DOUBLE PRECISION,
    writes_per_sec          DOUBLE PRECISION,
    avg_cpu_ms              DOUBLE PRECISION,
    avg_elapsed_ms          DOUBLE PRECISION,
    avg_reads               DOUBLE PRECISION,
    avg_writes              DOUBLE PRECISION,
    collected_at            TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (collected_at);

SELECT create_daily_partitions('procedure_stats_raw');
