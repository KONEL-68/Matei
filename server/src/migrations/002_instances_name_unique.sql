-- Migration 002: Add unique constraint on instance name
CREATE UNIQUE INDEX IF NOT EXISTS idx_instances_name_unique ON instances(name);
