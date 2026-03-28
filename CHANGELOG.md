# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- BlockingHistory: replaced single non-functional "View Estimated Plan" button with working "View Estimated Plan" and "View Actual Plan" buttons per blocking chain node, with plan XML display, source badges (cached/live), copy/close controls, and wait stats table for actual plans
- DiskChart: replaced IQR-filtered weighted linear regression forecasting with Holt's Linear Trend (Double Exponential Smoothing) — adapts to changing growth rates and handles irregular time spacing
- DiskChart: auto-scaling Y-axis zooms into actual data range instead of fixed 0-100, area fills with gradients for visual weight, smart threshold lines only shown when relevant, improved tooltip with volume names and proper date/time, increased chart height, fixed locale to en-GB

### Added
- Auto-create `matei_blocking` XE session: collector now ensures the Extended Events session exists and is running before querying for blocking events, with per-instance tracking, SQL Server restart detection, and graceful fallback on permission errors
- Live blocking config endpoint: `GET /api/metrics/:id/blocking/config` queries `blocked process threshold` setting directly from the SQL Server instance
- Blocking events backend: migration (021), collector, worker-pool integration, API routes, partition manager, and tests
- Migration 021: `blocking_events` partitioned table for blocking chain data with JSONB chain storage
- Blocking events collector (`server/src/collector/collectors/blocking-events.ts`): reads `matei_blocking` XE session, parses blocked process reports, builds directed blocking chains per head blocker
- API endpoints: `GET /api/metrics/:id/blocking`, `GET /api/blocking/recent`, `GET /api/blocking/counts`
- SQL reference file: `sql/blocking_events.sql` with server-side XML parsing of blocked_process_report events
- BlockingHistory component: historical blocking events table with expandable blocking chain tree, severity coloring, SQL syntax highlighting, and estimated plan button
- Permissions (server role members) tests: collector test and API route test for `/api/metrics/:id/permissions`
- Permissions table component: expandable role-based permissions view showing Windows logins, AD accounts, and SQL logins per server role with drill-down member list
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

### Changed
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
