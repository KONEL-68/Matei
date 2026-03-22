-- Migration 009: Settings table + users last_login

-- Settings key-value store
CREATE TABLE IF NOT EXISTS settings (
    key         VARCHAR(255) PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add last_login to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;
