# Matei — SQL Server Monitoring Platform

## Philosophy
- Pull-only architecture: central server connects to SQL Servers, NO agents
- No objects installed on monitored servers (no jobs, no databases, no stored procedures)
- Extended Events sessions and VIEW SERVER STATE — only things needed on target
- Must be fully open-source, no dependencies requiring paid licensing for commercial use
- Inspired by erikdarlingdata/PerformanceMonitor Lite edition approach but web-based

## Architecture
- Backend: Node.js + Fastify + TypeScript
- Frontend: React + TypeScript + shadcn/ui + Recharts
- Database: PostgreSQL with native partitioning for time-series
- SQL connectivity: mssql (tedious) package
- Deployment: Docker Compose (PostgreSQL + backend + frontend + nginx)
- All in one monorepo

## Project structure
```
/server     — Fastify API + collector scheduler + background jobs
/web        — React frontend (Vite)
/docker     — Docker Compose stack + nginx config
/sql        — DMV query library (one .sql file per metric category)
/docs       — architecture decisions, metric specs
```

## Code standards
- TypeScript strict mode everywhere
- All comments in English
- Use async/await, no callbacks
- Error handling: never swallow errors silently, always log
- SQL queries: parameterized, never string concatenation
- Connections: use connection pool, timeout 5s connect / 10s query
- Tests: Vitest for backend, Vitest + React Testing Library for frontend

## Collector design
- Worker pool: 40 concurrent workers
- Collection cycle: must complete 200 instances within 30 seconds
- Per-instance: connect → run DMV queries → disconnect → batch insert to PostgreSQL
- Delta metrics (wait_stats, query_stats, file_io): store snapshot in memory,
  compute delta, write delta to PostgreSQL
- Snapshot metrics (active sessions, server properties): write as-is
- Failed instance: log error, mark unreachable, continue to next, retry next cycle

## DMV query rules (CRITICAL)
- NEVER invent DMV queries from memory — use the reference queries in /sql/*.sql
- Wait stats are CUMULATIVE since SQL Server restart — always compute deltas
- Exclude benign system waits (list in /sql/excluded_waits.json)
- CPU from ring buffers: dm_os_ring_buffers WHERE ring_buffer_type = 'RING_BUFFER_SCHEDULER_MONITOR'
- Active sessions: only is_user_process = 1 unless explicitly viewing system
- NEVER call dm_exec_query_plan() in collector hot path — only on-demand in API
- All timestamps in UTC

## OS-level metrics via DMV (no WinRM/SSH needed)
Most OS metrics are available through SQL Server DMVs — no need for agents or OS-level access:
- CPU (SQL + OS + other): dm_os_ring_buffers (RING_BUFFER_SCHEDULER_MONITOR)
- Memory (OS + SQL process): dm_os_sys_memory + dm_os_process_memory
- Disk space per volume: dm_os_volume_stats (only volumes with SQL files)
- Disk I/O per file: dm_io_virtual_file_stats (delta, same as wait stats)
- OS info: dm_os_host_info (SQL 2017+, fallback to @@VERSION for 2016)

Phase 2 (optional, future): WinRM for Windows / SSH for Linux for full OS metrics
(network throughput, all disk volumes, services). This is NOT in scope for initial release.

## Data retention
- Raw metrics: 7 days (partitioned by day)
- 5-minute aggregates: 30 days
- Hourly aggregates: 1 year
- Background job handles rollup + partition management

## Permissions needed on monitored SQL Servers
- VIEW SERVER STATE (all metrics)
- VIEW DATABASE STATE (per-database metrics)
- No sysadmin, no db_owner, no SQL Agent access needed

## When adding a new metric
1. Create /sql/<metric_name>.sql with the exact DMV query
2. Add validation query in comment at top of file
3. Document: source DMV, collection frequency, aggregation type (delta/snapshot),
   units, what to show in UI
4. Add collector function in /server/src/collectors/<metric_name>.ts
5. Add PostgreSQL migration in /server/src/migrations/
6. Add API endpoint in /server/src/routes/
7. Add frontend component in /web/src/components/
