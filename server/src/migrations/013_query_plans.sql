-- Migration 013: Query plans table
-- Stores estimated and actual execution plans, deduplicated by plan hash

CREATE TABLE IF NOT EXISTS query_plans (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    instance_id     INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    query_hash      VARCHAR(100) NOT NULL,
    plan_hash       VARCHAR(64) NOT NULL,
    plan_type       VARCHAR(20) NOT NULL,  -- 'estimated' or 'actual'
    plan_xml        TEXT NOT NULL,
    collected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(instance_id, query_hash, plan_hash, plan_type)
);

CREATE INDEX IF NOT EXISTS idx_query_plans_lookup
    ON query_plans(instance_id, query_hash, plan_type, collected_at DESC);
