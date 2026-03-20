-- Migration 001: Initial schema
-- Creates all core tables for Matei monitoring platform

-- Monitored SQL Server instances
CREATE TABLE IF NOT EXISTS instances (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    host            VARCHAR(255) NOT NULL,
    port            INTEGER NOT NULL DEFAULT 1433,
    auth_type       VARCHAR(20) NOT NULL DEFAULT 'sql' CHECK (auth_type IN ('sql', 'windows')),
    encrypted_credentials BYTEA,
    is_enabled      BOOLEAN NOT NULL DEFAULT true,
    last_seen       TIMESTAMPTZ,
    status          VARCHAR(20) NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'online', 'unreachable')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (host, port)
);

-- Instance health snapshots (60s interval)
CREATE TABLE IF NOT EXISTS instance_health (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id         INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    instance_name       VARCHAR(255),
    edition             VARCHAR(255),
    version             VARCHAR(50),
    sp_level            VARCHAR(20),
    major_version       INTEGER,
    hadr_enabled        BOOLEAN,
    is_clustered        BOOLEAN,
    sqlserver_start_time TIMESTAMPTZ,
    uptime_seconds      INTEGER,
    cpu_count           INTEGER,
    hyperthread_ratio   INTEGER,
    physical_memory_mb  INTEGER,
    committed_mb        INTEGER,
    target_mb           INTEGER,
    max_workers_count   INTEGER,
    scheduler_count     INTEGER,
    collected_at        TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (collected_at);

-- Wait stats DELTAS (30s interval, stores computed deltas NOT raw cumulative values)
CREATE TABLE IF NOT EXISTS wait_stats_raw (
    id                          BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id                 INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    wait_type                   VARCHAR(100) NOT NULL,
    waiting_tasks_count_delta   BIGINT,
    wait_time_ms_delta          BIGINT,
    max_wait_time_ms            BIGINT,
    signal_wait_time_ms_delta   BIGINT,
    collected_at                TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (collected_at);

-- Active sessions snapshot (15s interval)
CREATE TABLE IF NOT EXISTS active_sessions_snapshot (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id             INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    session_id              INTEGER NOT NULL,
    request_id              INTEGER,
    blocking_session_id     INTEGER,
    session_status          VARCHAR(30),
    request_status          VARCHAR(30),
    login_name              VARCHAR(255),
    host_name               VARCHAR(255),
    program_name            VARCHAR(255),
    database_name           VARCHAR(255),
    command                 VARCHAR(100),
    wait_type               VARCHAR(100),
    wait_time_ms            INTEGER,
    wait_resource           VARCHAR(500),
    elapsed_time_ms         BIGINT,
    cpu_time_ms             BIGINT,
    logical_reads           BIGINT,
    writes                  BIGINT,
    row_count               BIGINT,
    open_transaction_count  INTEGER,
    isolation_level_desc    VARCHAR(30),
    granted_memory_kb       INTEGER,
    current_statement       TEXT,
    full_sql_text           TEXT,
    plan_handle             BYTEA,
    sql_handle              BYTEA,
    collected_at            TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (collected_at);

-- OS CPU utilization (30s interval)
CREATE TABLE IF NOT EXISTS os_cpu (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id             INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    sql_cpu_pct             SMALLINT,
    system_idle_pct         SMALLINT,
    other_process_cpu_pct   SMALLINT,
    collected_at            TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (collected_at);

-- OS memory (30s interval)
CREATE TABLE IF NOT EXISTS os_memory (
    id                                  BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id                         INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    os_total_memory_mb                  INTEGER,
    os_available_memory_mb              INTEGER,
    os_used_memory_mb                   INTEGER,
    os_memory_used_pct                  NUMERIC(5,2),
    os_page_file_total_mb               INTEGER,
    os_page_file_available_mb           INTEGER,
    system_memory_state_desc            VARCHAR(100),
    sql_physical_memory_mb              INTEGER,
    sql_locked_pages_mb                 INTEGER,
    sql_virtual_committed_mb            INTEGER,
    sql_memory_utilization_pct          INTEGER,
    sql_memory_low_notification         BOOLEAN,
    sql_virtual_memory_low_notification BOOLEAN,
    sql_committed_mb                    INTEGER,
    sql_target_mb                       INTEGER,
    collected_at                        TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (collected_at);

-- Disk space per volume (5min interval)
CREATE TABLE IF NOT EXISTS os_disk (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id         INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    volume_mount_point  VARCHAR(255),
    logical_volume_name VARCHAR(255),
    file_system_type    VARCHAR(50),
    total_mb            BIGINT,
    available_mb        BIGINT,
    used_mb             BIGINT,
    used_pct            NUMERIC(5,2),
    supports_compression BOOLEAN,
    is_compressed       BOOLEAN,
    collected_at        TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (collected_at);

-- File I/O stats DELTAS (30s interval, stores computed deltas NOT raw cumulative values)
CREATE TABLE IF NOT EXISTS file_io_stats (
    id                          BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id                 INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    database_name               VARCHAR(255),
    file_name                   VARCHAR(255),
    file_type                   VARCHAR(10),
    num_of_reads_delta          BIGINT,
    num_of_bytes_read_delta     BIGINT,
    io_stall_read_ms_delta      BIGINT,
    num_of_writes_delta         BIGINT,
    num_of_bytes_written_delta  BIGINT,
    io_stall_write_ms_delta     BIGINT,
    size_on_disk_bytes          BIGINT,
    collected_at                TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (collected_at);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
    id              SERIAL PRIMARY KEY,
    instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    alert_type      VARCHAR(100) NOT NULL,
    severity        VARCHAR(20) NOT NULL CHECK (severity IN ('warning', 'critical')),
    message         TEXT NOT NULL,
    acknowledged    BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_instance_id ON alerts(instance_id);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts(acknowledged) WHERE NOT acknowledged;

-- Migration tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(255) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Function: auto-create daily partitions for the next 7 days
CREATE OR REPLACE FUNCTION create_daily_partitions(
    p_table_name TEXT,
    p_days_ahead INTEGER DEFAULT 7
)
RETURNS void AS $$
DECLARE
    v_date DATE;
    v_partition_name TEXT;
    v_start TEXT;
    v_end TEXT;
BEGIN
    FOR i IN 0..p_days_ahead LOOP
        v_date := CURRENT_DATE + i;
        v_partition_name := p_table_name || '_' || TO_CHAR(v_date, 'YYYYMMDD');
        v_start := TO_CHAR(v_date, 'YYYY-MM-DD');
        v_end := TO_CHAR(v_date + 1, 'YYYY-MM-DD');

        IF NOT EXISTS (
            SELECT 1 FROM pg_class WHERE relname = v_partition_name
        ) THEN
            EXECUTE FORMAT(
                'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                v_partition_name, p_table_name, v_start, v_end
            );
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create initial partitions for all partitioned tables
SELECT create_daily_partitions('instance_health');
SELECT create_daily_partitions('wait_stats_raw');
SELECT create_daily_partitions('active_sessions_snapshot');
SELECT create_daily_partitions('os_cpu');
SELECT create_daily_partitions('os_memory');
SELECT create_daily_partitions('os_disk');
SELECT create_daily_partitions('file_io_stats');
