# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added (Sessions 20-23)
- Sticky StatusBar (z-10, bg-gray-950, border-b border-gray-800)
- History / Current Activity tabs with URL state (?tab=)
- Current Activity: status/blocking/elapsed/login/db filters, show system sessions toggle, WAITFOR excluded, expandable rows
- Table column widths: table-fixed with colgroup widths
- Elapsed time formatting: Xs / Xm Ys / Xh Ym / Xd Yh
- appName = 'Matei Monitor' in mssql connection config
- Reads/Writes: use dm_exec_requests instead of dm_exec_sessions
- Disk Space card: show used GB instead of free GB
- StatusBar: total wait ms/s with top-3 tooltip on hover
- Fleet Dashboard redesign: RedGate-style InstanceCard with 3 KPIs (Waits/CPU/Disk IO), alert status bar, group headers with health bar
- Overview Timeline with drag-selection window (4 metrics: CPU/Memory/Waits/Disk IO)
- Overview range selector (1h/6h/24h/7d) + window quick-select (15m/30m/1h/3h/12h)
- Analysis section with 3 tabs: Top Queries (Avg/Totals/Impact toggle, search, expand), Top Waits (Zoom/Full Range), Top Procedures (live from dm_exec_procedure_stats)
- Metric toggle checkboxes on overview timeline
- CPU axis fixed to 0-100 domain

### Added (Sessions 1-19)
- Fleet dashboard with instance health cards, CPU/memory bars, top waits, deadlock badges
- Dashboard: collapsible instance groups with grouped/ungrouped sections
- Instance management (add/edit/delete/test connection) with group assignment
- Instance groups: full CRUD, bulk instance assignment, inline group dropdown on instances page
- 10 metric collectors: instance health, wait stats, active sessions, OS CPU, OS memory, disk space, file I/O, query stats, deadlocks (XE system_health), performance counters (dm_os_performance_counters + dm_os_schedulers)
- Worker pool with configurable concurrency (default 40 workers)
- Alert engine with threshold-based alerts (CPU, memory, disk, I/O, blocking, unreachable)
- Alert investigation: "Investigate" button deep-links to instance at alert timestamp
- Webhook alert delivery with UI configuration (Settings > Alerts)
- Instance detail page: Grafana-style layout with StatusBar, CPU chart, Top Waits + Memory Breakdown + Disk Space + Session Breakdown in 4-column grid
- StatusBar: real-time KPI strip (CPU, Top Wait, Blocked, Pending, Read/Write IO, PLE, Mem Grants Pending, Batch Req/s) with Live indicator, independent of time range filter
- CPU chart: SQL CPU + Other CPU (Idle removed), custom dark tooltip with labels
- SQL Memory Breakdown: Total/Target/Stolen/Database Cache/Deficit with color-coded bars
- Session Breakdown card: Running/Runnable/Sleeping/Suspended counts (WAITFOR excluded)
- Wait Stats: stacked bar chart (historical) + compact Top 5 table (current)
- Active Sessions: point-in-time history scrubber with timestamp navigation
- Blocking chain visualization: tree with severity color-coding and HEAD BLOCKER badge
- Deadlock detection via XE system_health ring_buffer with XML viewer
- File I/O: time series chart (basename labels) + compact top-10 latency table
- Disk Space: compact card with colored progress bars, sorted by usage DESC
- Disk Growth Trend: historical chart with linear regression forecast ("fills in ~Xd" or "Stable")
- Collapsible sections with lazy loading (data fetched only when expanded)
- Custom time range picker (From/To datetime inputs) alongside presets
- Time range picker: 1h/6h/24h/7d/30d/1y presets + custom from/to
- Query Explorer page with top queries by CPU/reads/duration/executions
- On-demand execution plan retrieval (XML) from SQL Server
- Query stats collector with delta computation (runs every 60s)
- Data retention: partition manager (7d raw, 30d 5min, 1y hourly)
- Aggregation jobs (raw -> 5min -> hourly rollups)
- AES-256-GCM credential encryption
- Docker Compose deployment (PostgreSQL + backend + frontend + nginx)
- Dark mode with system preference detection and manual toggle
- JWT-based authentication with access/refresh tokens
- Auto-created admin user from environment variables on first startup
- Login page with token auto-refresh on 401
- User management: create/delete users, change password (Settings > Users)
- Settings page with tabs: Groups, Alerts (webhook config), Retention, Users, About
- Auto-migration on backend startup (pending migrations applied automatically)
- 305+ tests (180 backend + 125 frontend)

### Fixed
- Dark mode text colors on all pages (Instances table, forms, badges, empty states)
- Wait stats chart: X axis labels, stacked BarChart instead of AreaChart
- File I/O chart: basename-only labels in legend/tooltip
- perf_counters: RTRIM for nchar(128) counter_name matching
- perf_counters_raw: DOUBLE PRECISION column for rate counter decimal values
