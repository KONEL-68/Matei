-- Database properties snapshot (full replace per instance per cycle)
-- Collected every 5 minutes from sys.databases + msdb.dbo.backupset

CREATE TABLE database_properties (
    id BIGSERIAL PRIMARY KEY,
    instance_id INT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    database_name VARCHAR(128) NOT NULL,
    state_desc VARCHAR(60) NOT NULL,
    recovery_model_desc VARCHAR(60) NOT NULL,
    compatibility_level SMALLINT NOT NULL,
    collation_name VARCHAR(128),
    owner_name VARCHAR(128),
    create_date TIMESTAMPTZ,
    last_full_backup TIMESTAMPTZ,
    last_log_backup TIMESTAMPTZ,
    vlf_count INT,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_database_properties_instance ON database_properties (instance_id);
CREATE INDEX idx_database_properties_db ON database_properties (instance_id, database_name);

-- Database files snapshot (full replace per instance per cycle)
-- Collected from sys.master_files (no USE required)

CREATE TABLE database_files (
    id BIGSERIAL PRIMARY KEY,
    instance_id INT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    database_name VARCHAR(128) NOT NULL,
    file_name VARCHAR(128) NOT NULL,
    type_desc VARCHAR(60) NOT NULL,
    filegroup_name VARCHAR(128),
    physical_name VARCHAR(512),
    size_mb DOUBLE PRECISION NOT NULL,
    max_size INT NOT NULL,
    growth INT NOT NULL,
    is_percent_growth BOOLEAN NOT NULL DEFAULT FALSE,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_database_files_instance ON database_files (instance_id);
CREATE INDEX idx_database_files_db ON database_files (instance_id, database_name);
