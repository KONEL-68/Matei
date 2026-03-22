-- Migration 008: Deadlock tracking
-- Stores deadlock events captured from system_health XE session

CREATE TABLE IF NOT EXISTS deadlocks (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id         INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    deadlock_time       TIMESTAMPTZ NOT NULL,
    victim_spid         INTEGER,
    victim_query        TEXT,
    deadlock_xml        TEXT NOT NULL,
    collected_at        TIMESTAMPTZ NOT NULL,
    UNIQUE (instance_id, deadlock_time, collected_at)
) PARTITION BY RANGE (collected_at);

SELECT create_daily_partitions('deadlocks');

CREATE INDEX IF NOT EXISTS idx_deadlocks_instance_time ON deadlocks(instance_id, deadlock_time DESC);
