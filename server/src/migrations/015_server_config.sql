-- Migration 015: Server configuration table
-- Stores SQL Server configuration options from sys.configurations and SERVERPROPERTY
-- Collected once per instance on first connect (like os_host_info)
-- Single row per instance, upserted on each collection

CREATE TABLE IF NOT EXISTS server_config (
    instance_id                  INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    server_collation             VARCHAR(128),
    xp_cmdshell                  INTEGER,
    clr_enabled                  INTEGER,
    external_scripts_enabled     INTEGER,
    remote_access                INTEGER,
    max_degree_of_parallelism    INTEGER,
    max_server_memory_mb         BIGINT,
    cost_threshold_for_parallelism INTEGER,
    collected_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (instance_id)
);
