-- Migration 007: Instance groups
-- Allows organizing monitored instances into named groups

CREATE TABLE IF NOT EXISTS instance_groups (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE instances ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES instance_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_instances_group_id ON instances(group_id);
