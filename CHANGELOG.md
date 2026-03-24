# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- OverviewTimeline: RedGate SQL Monitor-style persistent draggable range selector with dim-outside overlay, blue edge lines, drag handles (ew-resize), center grab to move, click+drag to create new selection
- OverviewTimeline: default 1h window on page load, cursor changes (crosshair/grab/ew-resize) via CSS inheritance, document-level drag listeners
- OverviewTimeline: fill-forward null values so tooltip shows all 4 metrics consistently
- 4 detail metric charts in 2x2 grid below overview: CPU Utilization (SQL CPU + Other CPU), SQL Memory (Committed + Target + Deficit dotted line), Wait Stats (stacked bars with clickable legend toggle), Throughput (Read + Write MB/s)
- Overview chart API: disk I/O read/write split (disk_read_mb_per_sec, disk_write_mb_per_sec)

### Changed
- OverviewTimeline tooltip: reads from full data point object instead of Recharts payload (fixes missing metrics), z-index layering so tooltip renders above selection overlay
- Memory detail chart: shows SQL Committed + SQL Target instead of OS total, auto-scaled Y-axis, deficit only shown when Target > Committed
- Removed duplicate CPU Utilization chart (now in 2x2 grid)
- Removed duplicate Wait Stats History section (now in 2x2 grid)

### Fixed
- SessionBreakdown: "No session data" shown when all sessions are WAITFOR/diagnostics — now shows zero counts instead
- Disk Space: increased lookback from 10 to 15 minutes to handle collection timing jitter
- OverviewTimeline: overview-chart API Memory deficit logic corrected (deficit = Target - Committed, not the reverse)

### Previously added
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
- 236+ tests (backend + frontend)

### Fixed
- Dark mode text colors on all pages (Instances table, forms, badges, empty states)
- Wait stats chart: X axis labels, stacked BarChart instead of AreaChart
- File I/O chart: basename-only labels in legend/tooltip
- perf_counters: RTRIM for nchar(128) counter_name matching
- perf_counters_raw: DOUBLE PRECISION column for rate counter decimal values
