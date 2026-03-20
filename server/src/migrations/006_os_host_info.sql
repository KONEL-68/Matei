-- Migration 006: OS host info table
-- Stores static OS information from sys.dm_os_host_info (SQL Server 2017+)
-- Collected once per instance on first connect; re-collected if sqlserver_start_time changes

CREATE TABLE IF NOT EXISTS os_host_info (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY,
    instance_id             INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    host_platform           VARCHAR(50),
    host_distribution       VARCHAR(255),
    host_release            VARCHAR(100),
    host_service_pack_level VARCHAR(50),
    host_sku                INTEGER,
    os_language_version     INTEGER,
    collected_at            TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (collected_at);

SELECT create_daily_partitions('os_host_info');
