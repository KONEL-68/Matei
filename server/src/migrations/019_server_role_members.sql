CREATE TABLE IF NOT EXISTS server_role_members (
    instance_id    INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    role_name      VARCHAR(128) NOT NULL,
    login_name     VARCHAR(256) NOT NULL,
    login_type     VARCHAR(50) NOT NULL,
    collected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_server_role_members_instance ON server_role_members (instance_id, collected_at DESC);
