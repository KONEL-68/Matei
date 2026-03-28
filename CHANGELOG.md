# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- Database detail top queries now reuses the full AnalysisSection TopQueriesTab with sorting, view modes (Totals/Avg per execution/Impact), search, and configurable result limit
- TopQueriesTab accepts optional `db` prop to filter by database (hides Database column when filtering)

### Fixed
- Overview timeline metrics (memory, waits, disk I/O) now use independent Y-axes instead of sharing one, so each scales correctly

### Changed
- Wait Stats (ms/sec) chart moved out of 2x2 grid to full-width placement before Analysis section for better visibility
- New Signal vs Resource Wait (ms/s) stacked bar chart in the 2x2 grid replacing the old wait stats slot
- `GET /api/metrics/:id/waits/signal-resource-chart` endpoint for aggregated signal vs resource wait time series
- WaitsChart component now supports `from`/`to` time window props

### Added
- Per-database metrics collector: collects database-level performance counters (size, transactions, log activity) every 60s from `sys.dm_os_performance_counters` Databases object
  - Migration 022: `database_metrics_raw` partitioned table with database_name column
  - Collector with delta computation for rate counters (Transactions/sec, Log Flushes/sec, etc.) and snapshot for instantaneous (Data File Size, Active Transactions)
  - Partition manager support for automatic daily partition creation/cleanup
  - `GET /api/metrics/:id/databases` endpoint: list all databases with latest metrics, transactions/sec sparkline, and size sparkline data
  - `GET /api/metrics/:id/databases/:dbName` endpoint: time-series for all per-database counters plus on-demand live properties (recovery model, files, VLF count, backup dates) from SQL Server
  - DatabasesList component: collapsible database list in History tab with transactions/sec sparklines, size bars, search, pagination
  - DatabaseDetail component: expandable inline detail with 3-column chart grid (size, log activity, transactions), database properties, files table, VLF count with severity warnings
  - Database properties collector: persists sys.databases properties, sys.master_files info, VLF counts, and backup dates every 6 hours
  - Migration 023: `database_properties` and `database_files` snapshot tables
  - Status column in databases list showing ONLINE/OFFLINE state
  - Column sorting (name, status, transactions/sec, size) with clickable headers
  - Top Queries section in database detail showing top 10 queries by duration filtered to the specific database
  - `db` query parameter on `GET /api/queries/:id` endpoint for filtering queries by database name
- Blocking History section: full-stack blocking monitoring using Extended Events `blocked_process_report`
  - Auto-creates `matei_blocking` XE session on target servers; validates and recreates if misconfigured
  - Collector reads ring buffer XML in Node.js (avoids SQL Server XPath timeouts), builds directed blocking chains with head blocker determination
  - Deduplicates repeated events from same blocking scenario using composite key (SPID + login + DB + SQL), shows first occurrence time
  - Resolves numeric database IDs to names via `sys.databases` lookup
  - Migration 021: `blocking_events` partitioned table with JSONB chain storage
  - API endpoints: `GET /api/metrics/:id/blocking` (with cross-cycle dedup), `/blocking/config` (live threshold check), `/blocking/plan` (estimated + actual plan lookup)
  - BlockingHistory component: expandable head blocker table with severity coloring, recursive blocking tree, SQL syntax highlighting, View Estimated/Actual Plan buttons with XML display, source badges, wait stats extraction, Copy XML
  - Yellow warning banner when `blocked process threshold` is not configured
  - Plan collection for blocking SPIDs: persists estimated + actual plans for all involved sessions, not just top CPU queries
- DiskUsage component: per-volume disk table with space bars, avg read/write latency sparklines, transfers/sec sparklines
- `GET /api/metrics/:id/disk-usage` endpoint combining os_disk space with file_io_stats aggregates and sparkline time series
- `volume_mount_point` column in file_io_stats collector (via `dm_os_volume_stats` join) and migration 020
- `GET /api/metrics/:id/waits/latest` endpoint returning latest collection cycle's wait deltas for live StatusBar
- `GET /api/metrics/:id/file-io/latest` endpoint returning latest cycle's file I/O latency for live StatusBar
- Extended time ranges (7d/30d/1y) and from/to query params for `/api/queries/:id/:hash`
- Test coverage: webhook.ts, scheduler.ts, web/lib/auth.ts, web/lib/theme.ts, DiskUsage, DiskChart edge cases, BlockingHistory, blocking routes (105+ new tests)
- Permissions (server role members) tests: collector test and API route test for `/api/metrics/:id/permissions`
- Permissions table component: expandable role-based permissions view showing Windows logins, AD accounts, and SQL logins per server role with drill-down member list

### Changed
- StatusBar: all metrics now show latest collection cycle data (not time-range averages), refreshes every 15s independently of History tab time window
- DiskChart: Holt's Linear Trend forecasting (replaces IQR-filtered linear regression), auto-scaled Y-axis, gradient area fills, smart threshold lines, merged tooltip, all-volume forecast lines
- InstanceDetail: consolidated Disks section (DiskUsage + DiskChart), removed old Active Sessions/File I/O/Deadlocks/Blocking sections from History tab
- AnalysisSection: URL params built inside queryFn for proper reactivity
- Current Activity tab: moved Top Waits, SQL Memory Breakdown, Disk Space, and Session Breakdown cards from History tab; all data now fetched live from SQL Server (not PostgreSQL)
- Live API endpoints querying SQL Server directly: `/api/metrics/:id/live/sessions`, `/live/waits`, `/live/disk`, `/live/memory`, `/live/memory-clerks`
- Auto-refresh header moved above live cards; all cards + sessions refresh every 15s (controlled by toggle)
- Memory Grants Pending and Memory Grants Outstanding charts in SQL Server Metrics Memory section
- Memory Grants Outstanding perf counter added to collection whitelist
- Page Life Expectancy moved from Buffer Cache to Memory section
- Memory Clerks stacked bar chart (over time) in SQL Server Metrics Memory section: shows all clerks >100 MB with friendly names (e.g., "Buffer Pool", "Query Plans"), tooltip sorted by size
- Memory clerks metric: historical collection from `sys.dm_os_memory_clerks` every 2nd cycle (60s), snapshot metric
- Migration 018: `memory_clerks_raw` partitioned table for memory clerk data
- Memory clerks collector (`server/src/collector/collectors/memory-clerks.ts`)
- API endpoint: `GET /api/metrics/:id/memory-clerks` returns time-series data for clerks >100 MB
- SQL reference file: `sql/memory_clerks.sql`
- Memory Grants chart in SQL Server Metrics: multi-line chart showing Memory Grants Pending and Memory Grants Outstanding counters
- Memory Grants Outstanding perf counter: added to collection whitelist (cntr_type 65792, instantaneous)
- Shared `generateTicks` helper in chart-utils for numeric x-axis tick generation across all time-series charts
- Shared chart-utils library (`web/src/lib/chart-utils.ts`): extracted `insertGapBreaks` and `fillAllNulls` from OverviewTimeline for reuse across all time-series charts
- Query detail panel: parse and display WaitStats from actual execution plan XML with wait type, description, time, and count
- parseWaitStats utility: extracts Wait elements from SQL Server actual plan XML, handles namespaces and deduplication
- Copy plan XML button in query detail panel (copies full execution plan to clipboard)
- SQL Server Metrics section: Redgate SQL Monitor-inspired collapsible section on Instance Detail with subsections (General, Latches & Locks, Buffer Cache, Server Properties, Server Configuration Options)
- Perf counter charts: Batch Requests/sec, SQL Compilations/sec, Page Splits/sec, Full Scans/sec, User Connections, Avg Latch Wait, Lock Timeouts/sec, Lock Waits/sec, Page Life Expectancy, plus ratio charts
- Server config collector: collects sys.configurations + SERVERPROPERTY on first connect, stored in PostgreSQL
- Server config API endpoint: GET /api/metrics/:id/server-config
- 5 new perf counters: Page Splits/sec, Full Scans/sec, Lock Timeouts/sec, Latch Waits/sec, Total Latch Wait Time (ms)
- Migration 015: server_config table with UPSERT support
- Expandable procedure detail rows: click a procedure to see individual SQL statements with performance stats
- Procedure statements: sortable columns (Seq, Executions, CPU, Duration, Reads, Writes), click row for full SQL text
- Procedure stats delta collector: collects dm_exec_procedure_stats every 60s, stored in PostgreSQL with time range support
- Procedure statements collector: collects statements for top procedures every 60s, stored in PostgreSQL
- Migration 016: procedure_stats_raw table with daily partitioning
- Migration 017: procedure_statements_raw table with daily partitioning
- GET /api/queries/:id/procedure-stats: PostgreSQL-backed procedure stats with time range filtering
- GET /api/queries/:id/procedure-statements-history: PostgreSQL-backed procedure statements with time range
- Shared SQL Server connection pool cache for API routes (5-minute idle timeout, auto-reconnect)
- Specialized Claude Code agents: matei-backend-dev, matei-frontend-dev, sql-server-dba
- Full test coverage: 495 tests across 81 files (299 backend + 196 frontend)
- Agent memory system with persistent rules (always write tests, always update docs)
- Fleet dashboard with instance health cards, CPU/memory bars, top waits, deadlock badges
- Dashboard: collapsible instance groups with grouped/ungrouped sections
- Instance management (add/edit/delete/test connection) with group assignment
- Instance groups: full CRUD, bulk instance assignment, inline group dropdown on instances page
- 12 metric collectors: instance health, wait stats, active sessions, OS CPU, OS memory, disk space, file I/O, query stats, deadlocks (XE system_health), performance counters, procedure stats, server config
- Worker pool with configurable concurrency (default 40 workers)
- Alert engine with threshold-based alerts (CPU, memory, disk, I/O, blocking, unreachable)
- Alert investigation: "Investigate" button deep-links to instance at alert timestamp
- Webhook alert delivery with UI configuration (Settings > Alerts)
- Instance detail page: Grafana-style layout with StatusBar, CPU chart, Top Waits + Memory Breakdown + Disk Space + Session Breakdown in 4-column grid
- StatusBar: real-time KPI strip with Live indicator, sticky positioning
- SQL Memory Breakdown: Total/Target/Stolen/Database Cache/Deficit with color-coded bars
- Session Breakdown card: Running/Runnable/Sleeping/Suspended counts (WAITFOR excluded)
- Wait Stats: stacked bar chart (historical) + compact Top 5 table (current)
- Active Sessions: point-in-time history scrubber with timestamp navigation
- History / Current Activity tabs with URL state (?tab=)
- Current Activity: status/blocking/elapsed/login/db filters, show system sessions toggle, expandable rows
- Blocking chain visualization: tree with severity color-coding and HEAD BLOCKER badge
- Deadlock detection via XE system_health ring_buffer with XML viewer
- File I/O: time series chart (basename labels) + compact top-10 latency table
- Disk Space: compact card showing used GB with colored progress bars
- Disk Growth Trend: historical chart with linear regression forecast
- Collapsible sections with lazy loading
- Custom time range picker (From/To datetime inputs) alongside presets (1h/6h/24h/7d/30d/1y)
- Query Explorer page with top queries by CPU/reads/duration/executions
- On-demand execution plan retrieval (estimated + actual) from SQL Server, cached in PostgreSQL
- Query stats collector with delta computation (runs every 60s)
- Data retention: partition manager (7d raw, 30d 5min, 1y hourly)
- Aggregation jobs (raw -> 5min -> hourly rollups)
- AES-256-GCM credential encryption
- Docker Compose deployment (PostgreSQL + backend + frontend + nginx)
- Dark mode with system preference detection and manual toggle
- JWT-based authentication with access/refresh tokens
- Auto-created admin user from environment variables on first startup
- User management: create/delete users, change password (Settings > Users)
- Settings page with tabs: Groups, Alerts, Retention, Users, About
- Auto-migration on backend startup
- Overview Timeline with drag-selection and window quick-select
- OverviewMetricCharts: per-metric detail charts below overview
- Analysis section: tabs (Top Queries, Tracked Queries, Top Procedures) with sortable columns
- Top Queries: Totals/Avg/Impact modes, expandable detail with time-series charts, memory grants, execution plans
- Tracked Queries: persist queries for monitoring via bookmark icon
- Top Procedures: search, limit selector, expandable detail with statement breakdown
- Query plan persistence: cached in PostgreSQL, deduplicated by MD5 hash
- Memory grant tracking from dm_exec_query_stats

- Current Activity tab cards query SQL Server live instead of reading from PostgreSQL
- Memory Breakdown component accepts optional `refetchInterval` prop
- Analysis section wrapped in CollapsibleSection (same style as SQL Server Metrics)
- Top Procedures: data now served from PostgreSQL with time range filtering (was live SQL Server query)
- Procedure statements: served from PostgreSQL history (was live SQL Server query)
- Query waits section: replaced live SQL Server call with message pointing to actual execution plans
- Top Procedures default limit changed from 50 to 25
- Procedures query uses GROUP BY to eliminate duplicates from multiple cached plans
- Procedures query optimized with CTE (aggregates on integer keys, resolves names only for TOP N)
- Analysis section: default query mode changed from Avg to Totals, moved above Active Sessions
- Top Queries/Procedures columns renamed to match RedGate style
- Added procedure_stats_raw and query_stats_raw to partition manager RAW_TABLES

### Removed
- Top Waits tab from Analysis section (redundant with Top Waits table in grid)
- Live SQL Server calls from History tab (all data now from PostgreSQL)

### Fixed
- All metric API endpoints: fix PostgreSQL Date objects compared by reference in Set/Map by converting bucket timestamps to ISO strings (affected overview-chart, waits/chart, file-io/chart, disk, perf-counters)
- Live waits endpoint: filter excluded waits in SQL query (NOT IN clause) instead of post-filter, fixing empty Top Waits card
- All time-series charts show proportional gaps when data wasn't collected (e.g., backend offline overnight): OverviewTimeline, CPU, Memory, File I/O, Disk, Throughput, SQL Server Metrics, Wait Stats bar charts
- OverviewTimeline x-axis spans full selected time range (1h/6h/24h/7d) with evenly spaced ticks
- Chart line droop at edges fixed: switched from monotone to linear interpolation across all charts
- Wait Stats bar charts (WaitsChart, WaitsMiniChart): fill empty time buckets so gaps render as proportional empty space
- White screen crash in Top Procedures: null-safe formatNum and ISNULL in SQL for NULL schema names
- Procedure statements returning no data: OBJECT_ID needs 3-part name for cross-database resolution
- Numeric sort bug: SQL Server bigint values returned as strings caused alphabetic sorting
- Seq column shows fixed procedure position regardless of current sort order
- Dark mode text colors on all pages
- Wait stats chart: X axis labels, stacked BarChart
- File I/O chart: basename-only labels
- perf_counters: RTRIM for nchar(128) counter_name matching
- perf_counters_raw: DOUBLE PRECISION for rate counter decimal values
- Disk Space card: show used GB instead of free GB
- Overview Timeline drag overlay positioning and tooltip values
- Procedure statements batch insert failing due to NULL procedure_name from cross-database OBJECT_NAME
