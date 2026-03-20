-- Metric: OS Host Info
-- Source: sys.dm_os_host_info (SQL Server 2017+)
-- Frequency: on connect only (static data)
-- Aggregation: snapshot
-- Docs: https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-views/sys-dm-os-host-info-transact-sql
--
-- NOTE: This DMV is only available in SQL Server 2017+.
-- For SQL Server 2016, fall back to @@VERSION parsing.

SELECT
    host_platform,          -- 'Windows' or 'Linux'
    host_distribution,      -- e.g. 'Windows Server 2019 Datacenter' or 'Ubuntu 22.04.3 LTS'
    host_release,           -- kernel version on Linux, OS build on Windows
    host_service_pack_level,
    host_sku,
    os_language_version,
    GETUTCDATE()            AS collected_at_utc
FROM sys.dm_os_host_info;
