-- Migration 003: Aggregation rollup tables
-- 5-minute and hourly rollups, partitioned by month

-- Wait stats 5-minute rollup
CREATE TABLE IF NOT EXISTS wait_stats_5min (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    bucket          TIMESTAMPTZ NOT NULL,
    wait_type       VARCHAR(100) NOT NULL,
    avg_wait_ms_per_sec   DOUBLE PRECISION,
    max_wait_ms_per_sec   DOUBLE PRECISION,
    total_wait_time_ms    BIGINT,
    sample_count          INTEGER,
    UNIQUE (instance_id, bucket, wait_type)
) PARTITION BY RANGE (bucket);

-- Wait stats hourly rollup
CREATE TABLE IF NOT EXISTS wait_stats_hourly (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    bucket          TIMESTAMPTZ NOT NULL,
    wait_type       VARCHAR(100) NOT NULL,
    avg_wait_ms_per_sec   DOUBLE PRECISION,
    max_wait_ms_per_sec   DOUBLE PRECISION,
    total_wait_time_ms    BIGINT,
    sample_count          INTEGER,
    UNIQUE (instance_id, bucket, wait_type)
) PARTITION BY RANGE (bucket);

-- CPU 5-minute rollup
CREATE TABLE IF NOT EXISTS os_cpu_5min (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    bucket          TIMESTAMPTZ NOT NULL,
    avg_sql_cpu_pct       DOUBLE PRECISION,
    max_sql_cpu_pct       SMALLINT,
    avg_system_idle_pct   DOUBLE PRECISION,
    sample_count          INTEGER,
    UNIQUE (instance_id, bucket)
) PARTITION BY RANGE (bucket);

-- CPU hourly rollup
CREATE TABLE IF NOT EXISTS os_cpu_hourly (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    bucket          TIMESTAMPTZ NOT NULL,
    avg_sql_cpu_pct       DOUBLE PRECISION,
    max_sql_cpu_pct       SMALLINT,
    avg_system_idle_pct   DOUBLE PRECISION,
    sample_count          INTEGER,
    UNIQUE (instance_id, bucket)
) PARTITION BY RANGE (bucket);

-- Memory 5-minute rollup
CREATE TABLE IF NOT EXISTS os_memory_5min (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    bucket          TIMESTAMPTZ NOT NULL,
    avg_available_memory_mb   DOUBLE PRECISION,
    min_available_memory_mb   INTEGER,
    avg_sql_committed_mb      DOUBLE PRECISION,
    max_sql_committed_mb      INTEGER,
    sample_count              INTEGER,
    UNIQUE (instance_id, bucket)
) PARTITION BY RANGE (bucket);

-- Memory hourly rollup
CREATE TABLE IF NOT EXISTS os_memory_hourly (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    bucket          TIMESTAMPTZ NOT NULL,
    avg_available_memory_mb   DOUBLE PRECISION,
    min_available_memory_mb   INTEGER,
    avg_sql_committed_mb      DOUBLE PRECISION,
    max_sql_committed_mb      INTEGER,
    sample_count              INTEGER,
    UNIQUE (instance_id, bucket)
) PARTITION BY RANGE (bucket);

-- File I/O 5-minute rollup
CREATE TABLE IF NOT EXISTS file_io_5min (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    bucket          TIMESTAMPTZ NOT NULL,
    database_name   VARCHAR(255),
    file_name       VARCHAR(255),
    avg_read_latency_ms     DOUBLE PRECISION,
    max_read_latency_ms     DOUBLE PRECISION,
    avg_write_latency_ms    DOUBLE PRECISION,
    max_write_latency_ms    DOUBLE PRECISION,
    total_reads             BIGINT,
    total_writes            BIGINT,
    sample_count            INTEGER,
    UNIQUE (instance_id, bucket, database_name, file_name)
) PARTITION BY RANGE (bucket);

-- File I/O hourly rollup
CREATE TABLE IF NOT EXISTS file_io_hourly (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    bucket          TIMESTAMPTZ NOT NULL,
    database_name   VARCHAR(255),
    file_name       VARCHAR(255),
    avg_read_latency_ms     DOUBLE PRECISION,
    max_read_latency_ms     DOUBLE PRECISION,
    avg_write_latency_ms    DOUBLE PRECISION,
    max_write_latency_ms    DOUBLE PRECISION,
    total_reads             BIGINT,
    total_writes            BIGINT,
    sample_count            INTEGER,
    UNIQUE (instance_id, bucket, database_name, file_name)
) PARTITION BY RANGE (bucket);

-- Create initial monthly partitions (current + next 2 months)
DO $$
DECLARE
    v_tables TEXT[] := ARRAY[
        'wait_stats_5min', 'wait_stats_hourly',
        'os_cpu_5min', 'os_cpu_hourly',
        'os_memory_5min', 'os_memory_hourly',
        'file_io_5min', 'file_io_hourly'
    ];
    v_table TEXT;
    v_date DATE;
    v_partition_name TEXT;
    v_start TEXT;
    v_end TEXT;
BEGIN
    FOREACH v_table IN ARRAY v_tables LOOP
        FOR i IN 0..2 LOOP
            v_date := date_trunc('month', CURRENT_DATE + (i || ' months')::interval)::date;
            v_partition_name := v_table || '_' || TO_CHAR(v_date, 'YYYYMM');
            v_start := TO_CHAR(v_date, 'YYYY-MM-DD');
            v_end := TO_CHAR((v_date + INTERVAL '1 month')::date, 'YYYY-MM-DD');

            IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = v_partition_name) THEN
                EXECUTE FORMAT(
                    'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                    v_partition_name, v_table, v_start, v_end
                );
            END IF;
        END LOOP;
    END LOOP;
END;
$$;
