-- Migration 014: Add memory grant columns to query_stats_raw
-- Source: sys.dm_exec_query_stats.last_grant_kb / last_used_grant_kb (SQL Server 2016+)

ALTER TABLE query_stats_raw ADD COLUMN IF NOT EXISTS last_grant_kb BIGINT;
ALTER TABLE query_stats_raw ADD COLUMN IF NOT EXISTS last_used_grant_kb BIGINT;
