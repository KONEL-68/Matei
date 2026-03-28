CREATE TABLE IF NOT EXISTS blocking_events (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id         INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    event_time          TIMESTAMPTZ NOT NULL,
    head_blocker_spid   INTEGER NOT NULL,
    head_blocker_login  VARCHAR(255),
    head_blocker_host   VARCHAR(255),
    head_blocker_app    VARCHAR(255),
    head_blocker_db     VARCHAR(255),
    head_blocker_sql    TEXT,
    chain_json          JSONB NOT NULL,
    total_blocked_count INTEGER NOT NULL,
    max_wait_time_ms    BIGINT NOT NULL,
    collected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (collected_at);

SELECT create_daily_partitions('blocking_events');

CREATE INDEX IF NOT EXISTS idx_blocking_events_instance_time
    ON blocking_events(instance_id, collected_at DESC);
