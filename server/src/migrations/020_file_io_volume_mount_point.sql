-- Add volume_mount_point to file I/O stats tables for per-volume aggregation

ALTER TABLE file_io_stats
    ADD COLUMN IF NOT EXISTS volume_mount_point VARCHAR(255);

ALTER TABLE file_io_5min
    ADD COLUMN IF NOT EXISTS volume_mount_point VARCHAR(255);

ALTER TABLE file_io_hourly
    ADD COLUMN IF NOT EXISTS volume_mount_point VARCHAR(255);
