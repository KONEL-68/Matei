# Metrics Specification

Each metric follows this template:
- **Source DMV**: which system view to query
- **Collection frequency**: how often to collect
- **Aggregation**: delta (compute difference between snapshots) or snapshot (current state)
- **Storage unit**: what to store in PostgreSQL
- **UI display**: what to show in the frontend
- **Validation query**: SQL to run manually and compare with Matei output

---

## Metric 1 — Instance Health

**Source DMVs:**
- `sys.dm_os_sys_info` → cpu_count, sqlserver_start_time, physical_memory_kb
- `sys.databases` → name, state_desc, is_cdc_enabled, recovery_model_desc
- `@@VERSION` → full version string
- `SERVERPROPERTY()` → Edition, ProductVersion, ProductLevel, IsHadrEnabled

**Collection frequency:** every 60 seconds
**Aggregation:** snapshot (not delta) — always current value
**Storage unit:** as-is (string/int/bool)

**Validation query:**
```sql
SELECT
    SERVERPROPERTY('ServerName')        AS instance_name,
    SERVERPROPERTY('Edition')           AS edition,
    SERVERPROPERTY('ProductVersion')    AS version,
    SERVERPROPERTY('ProductLevel')      AS sp_level,
    SERVERPROPERTY('IsHadrEnabled')     AS hadr_enabled,
    si.sqlserver_start_time,
    DATEDIFF(SECOND, si.sqlserver_start_time, GETUTCDATE()) AS uptime_seconds,
    si.cpu_count,
    si.physical_memory_kb / 1024        AS physical_memory_mb,
    si.committed_kb / 1024              AS committed_mb,
    si.committed_target_kb / 1024       AS target_mb
FROM sys.dm_os_sys_info si;
```

**Notes:**
- sqlserver_start_time resets on restart — use as heartbeat
- physical_memory_kb may differ from OS total if SQL is in container
- Always collect in UTC (GETUTCDATE()), never local time

---

## Metric 2 — Wait Stats (Top Waits)

**Source DMV:** `sys.dm_os_wait_stats`
**Docs:** https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-views/sys-dm-os-wait-stats-transact-sql

**Collection frequency:** every 30 seconds
**Aggregation:** DELTA between snapshots — store `(current - previous) / elapsed_seconds`

### CRITICAL: Cumulative counters
Values in `sys.dm_os_wait_stats` are CUMULATIVE since SQL Server start.
Never show raw values. Always compute delta between two consecutive snapshots.

**Delta formula:**
```
wait_ms_per_sec = (curr.wait_time_ms - prev.wait_time_ms) / elapsed_seconds
waits_per_sec   = (curr.waiting_tasks_count - prev.waiting_tasks_count) / elapsed_seconds
```

**Exclude benign waits:** see `/sql/excluded_waits.json`

**Validation query:**
```sql
SELECT TOP 15
    wait_type,
    wait_time_ms,
    waiting_tasks_count,
    CAST(wait_time_ms * 100.0 / NULLIF(SUM(wait_time_ms) OVER(), 0) AS DECIMAL(5,2)) AS pct_of_total
FROM sys.dm_os_wait_stats
WHERE wait_type NOT IN (
    SELECT wait_type FROM OPENJSON('[
        "SLEEP_TASK","LAZYWRITER_SLEEP","SQLTRACE_BUFFER_FLUSH",
        "WAITFOR","BROKER_TO_FLUSH","BROKER_TASK_STOP",
        "CLR_AUTO_EVENT","DISPATCHER_QUEUE_SEMAPHORE",
        "FT_IFTS_SCHEDULER_IDLE_WAIT","HADR_WORK_QUEUE",
        "LOGMGR_QUEUE","ONDEMAND_TASK_QUEUE",
        "REQUEST_FOR_DEADLOCK_SEARCH","RESOURCE_QUEUE",
        "SERVER_IDLE_CHECK","XE_DISPATCHER_WAIT","XE_TIMER_EVENT",
        "SLEEP_DBSTARTUP","SLEEP_DBRECOVER","SLEEP_MASTERDBREADY"
    ]') WITH (wait_type NVARCHAR(100) '$')
)
  AND wait_time_ms > 0
ORDER BY wait_time_ms DESC;
```

**Notes:**
- If sqlserver_start_time changed between snapshots → instance restarted → skip delta, store restart event
- Store snapshot in memory (not DB) — only store delta to PostgreSQL

---

## Metric 3 — Active Sessions / Blocking

**Source DMVs:**
- `sys.dm_exec_sessions` → session info
- `sys.dm_exec_requests` → running requests
- `sys.dm_exec_sql_text()` → query text
- `sys.dm_exec_query_plan()` → query plan (optional, expensive — on-demand only)
- `sys.dm_os_waiting_tasks` → precise wait info per task

**Collection frequency:** every 15 seconds (real-time feel)
**Aggregation:** snapshot — current state only, no delta

### Important rules
- Only collect sessions where `status IN ('running', 'suspended', 'sleeping') AND open_transaction_count > 0`
  OR requests that are blocked (`blocking_session_id > 0`)
- `session_id < 51` = system sessions — collect but mark as `is_system = true`
- `elapsed_time_ms = DATEDIFF(ms, r.start_time, GETUTCDATE())` — compute server-side
- `blocking_session_id > 0` means this session is BLOCKED BY that session
- Head blocker = session that blocks others but is not itself blocked

**Validation query:**
```sql
SELECT
    s.session_id,
    r.blocking_session_id,
    s.status,
    s.login_name,
    s.host_name,
    s.program_name,
    DB_NAME(r.database_id)                          AS database_name,
    r.wait_type,
    r.wait_time,
    r.total_elapsed_time,
    SUBSTRING(st.text, (r.statement_start_offset/2)+1,
        ((CASE r.statement_end_offset
            WHEN -1 THEN DATALENGTH(st.text)
            ELSE r.statement_end_offset
          END - r.statement_start_offset)/2)+1)     AS current_statement,
    r.open_transaction_count,
    s.transaction_isolation_level,
    CASE s.transaction_isolation_level
        WHEN 0 THEN 'Unspecified'
        WHEN 1 THEN 'READ UNCOMMITTED'
        WHEN 2 THEN 'READ COMMITTED'
        WHEN 3 THEN 'REPEATABLE READ'
        WHEN 4 THEN 'SERIALIZABLE'
        WHEN 5 THEN 'SNAPSHOT'
    END                                             AS isolation_level_desc
FROM sys.dm_exec_sessions s
LEFT JOIN sys.dm_exec_requests r ON s.session_id = r.session_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) st
WHERE s.is_user_process = 1
  AND (r.session_id IS NOT NULL OR s.open_transaction_count > 0)
ORDER BY r.blocking_session_id DESC, s.session_id;
```

**Notes:**
- Blocking chain depth > 3 = alert candidate
- Same query blocked > 30 seconds = alert candidate
- Never call `sys.dm_exec_query_plan()` in the collector hot path — too expensive.
  Call it only on-demand when user opens session detail in UI
