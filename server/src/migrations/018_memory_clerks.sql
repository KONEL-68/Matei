-- Memory clerks from dm_os_memory_clerks
-- Stores top memory clerks by size per collection (snapshot metric, every 2nd cycle)

CREATE TABLE memory_clerks_raw (
    id BIGSERIAL,
    instance_id INT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    clerk_type VARCHAR(128) NOT NULL,
    size_mb FLOAT NOT NULL,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (collected_at);

-- Create partitions for 7 days
DO $$
DECLARE
    d DATE := CURRENT_DATE;
BEGIN
    FOR i IN 0..7 LOOP
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS memory_clerks_raw_%s PARTITION OF memory_clerks_raw FOR VALUES FROM (%L) TO (%L)',
            to_char(d + i, 'YYYYMMDD'),
            d + i,
            d + i + 1
        );
    END LOOP;
END $$;

CREATE INDEX idx_memory_clerks_raw_instance_time ON memory_clerks_raw (instance_id, collected_at DESC);
