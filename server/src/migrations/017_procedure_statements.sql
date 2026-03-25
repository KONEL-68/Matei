CREATE TABLE IF NOT EXISTS procedure_statements_raw (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id             INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    database_name           VARCHAR(255),
    procedure_name          VARCHAR(500) NOT NULL,
    statement_start_offset  INTEGER NOT NULL,
    statement_text          TEXT,
    execution_count         BIGINT,
    total_cpu_ms            BIGINT,
    total_elapsed_ms        BIGINT,
    physical_reads          BIGINT,
    logical_reads           BIGINT,
    logical_writes          BIGINT,
    avg_cpu_ms              DOUBLE PRECISION,
    avg_elapsed_ms          DOUBLE PRECISION,
    min_grant_kb            BIGINT,
    last_grant_kb           BIGINT,
    collected_at            TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (collected_at);

SELECT create_daily_partitions('procedure_statements_raw');
