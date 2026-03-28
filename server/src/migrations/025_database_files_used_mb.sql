-- Add used_mb column to database_files for tracking actual space usage per file
-- Collected via FILEPROPERTY(name, 'SpaceUsed') per database context

ALTER TABLE database_files ADD COLUMN IF NOT EXISTS used_mb DOUBLE PRECISION;
