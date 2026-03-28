-- Per-database performance counters (size, transactions, log activity)
-- Collected every 60s from sys.dm_os_performance_counters (Databases object)

CREATE TABLE database_metrics_raw (
    id BIGSERIAL,
    instance_id INT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    database_name VARCHAR(128) NOT NULL,
    counter_name VARCHAR(128) NOT NULL,
    cntr_value DOUBLE PRECISION NOT NULL,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (collected_at);

-- Create partitions for 7 days
DO $$
DECLARE
    d DATE := CURRENT_DATE;
BEGIN
    FOR i IN 0..7 LOOP
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS database_metrics_raw_%s PARTITION OF database_metrics_raw FOR VALUES FROM (%L) TO (%L)',
            to_char(d + i, 'YYYYMMDD'),
            d + i,
            d + i + 1
        );
    END LOOP;
END $$;

CREATE INDEX idx_database_metrics_raw_instance_time ON database_metrics_raw (instance_id, collected_at DESC);
CREATE INDEX idx_database_metrics_raw_db_counter ON database_metrics_raw (instance_id, database_name, counter_name, collected_at DESC);
