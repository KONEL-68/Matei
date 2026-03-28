-- Overview baseline: per-instance, per-metric, per-hour-of-day baseline stats
-- Computed from last 7 days of hourly aggregates, refreshed every 6 hours
-- Used for RedGate-style baseline overlay on OverviewTimeline charts

CREATE TABLE IF NOT EXISTS overview_baseline (
    instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    metric          VARCHAR(16) NOT NULL,   -- 'cpu', 'memory', 'waits', 'disk_io'
    hour_of_day     SMALLINT NOT NULL,      -- 0-23 UTC
    baseline_min    DOUBLE PRECISION,
    baseline_avg    DOUBLE PRECISION,
    baseline_max    DOUBLE PRECISION,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (instance_id, metric, hour_of_day)
);
