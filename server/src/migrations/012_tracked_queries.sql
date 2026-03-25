-- Migration 012: Tracked queries table
-- Stores query hashes that users want to monitor over time

CREATE TABLE IF NOT EXISTS tracked_queries (
    id              SERIAL PRIMARY KEY,
    instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    query_hash      VARCHAR(100) NOT NULL,
    label           VARCHAR(255),
    statement_text  TEXT,
    database_name   VARCHAR(255),
    tracked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tracked_by      VARCHAR(255),
    UNIQUE(instance_id, query_hash)
);

CREATE INDEX IF NOT EXISTS idx_tracked_queries_instance ON tracked_queries(instance_id);
