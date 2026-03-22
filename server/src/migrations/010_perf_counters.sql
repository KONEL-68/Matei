-- Performance counters from dm_os_performance_counters
-- Stores both rate-based (Batch Requests/sec) and instantaneous (User Connections, PLE) counters

CREATE TABLE perf_counters_raw (
    id BIGSERIAL,
    instance_id INT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    counter_name VARCHAR(128) NOT NULL,
    cntr_value BIGINT NOT NULL,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (collected_at);

-- Create partitions for 7 days
DO $$
DECLARE
    d DATE := CURRENT_DATE;
BEGIN
    FOR i IN 0..7 LOOP
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS perf_counters_raw_%s PARTITION OF perf_counters_raw FOR VALUES FROM (%L) TO (%L)',
            to_char(d + i, 'YYYYMMDD'),
            d + i,
            d + i + 1
        );
    END LOOP;
END $$;

CREATE INDEX idx_perf_counters_raw_instance_time ON perf_counters_raw (instance_id, collected_at DESC);
CREATE INDEX idx_perf_counters_raw_counter ON perf_counters_raw (instance_id, counter_name, collected_at DESC);
