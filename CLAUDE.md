# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Build & development commands
```bash
# Development
docker compose -f docker/docker-compose.yml up -d postgres   # start PostgreSQL
cd server && npm install && npm run dev                       # backend with hot reload (tsx watch)
cd web && npm install && npm run dev                          # frontend Vite dev server (port 5173)

# Testing
cd server && npx vitest run                  # all backend tests
cd server && npx vitest run src/path/test.ts # single test file
cd web && npx vitest run                     # all frontend tests

# Build
cd server && npm run build                   # TypeScript → dist/
cd web && npm run build                      # tsc + Vite build

# Database migrations
cd server && npm run migrate                 # run pending migrations

# Full stack (Docker)
docker compose -f docker/docker-compose.yml up --build       # all services on port 80
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
- file_io_stats is also cumulative (delta computation same pattern as wait_stats)
- os_cpu ring_buffer approach is deprecated in SQL Server 2025 — plan migration to dm_os_ring_buffer_entries

## Collection frequencies
| Metric | Frequency | Type |
|--------|-----------|------|
| active_sessions | 15s | snapshot |
| wait_stats | 30s | delta |
| os_cpu | 30s | snapshot |
| os_memory | 30s | snapshot |
| file_io_stats | 30s | delta |
| instance_health | 60s | snapshot |
| os_disk | 5min | snapshot |
| os_host_info | on connect | snapshot |

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

## Key data flows
- **Collector cycle**: scheduler.ts triggers → worker-pool.ts fans out (40 concurrent) →
  individual collectors run DMV queries → batch insert results to PostgreSQL
- **Delta metrics**: collector stores previous snapshot in memory (Map keyed by instance),
  computes diff on next cycle, writes only the delta. Restart detection via sqlserver_start_time
  change resets the baseline.
- **Credentials**: encrypted at rest with AES-256-GCM (lib/crypto.ts), decrypted only at
  connection time (lib/mssql.ts). ENCRYPTION_KEY from environment.
- **Alerts**: engine.ts evaluates thresholds after each collection cycle, uses in-memory
  cycle counting for multi-cycle thresholds, 15-minute dedup cooldown.

## Alert thresholds (server/src/alerts/engine.ts)
| Metric | Warning | Critical |
|--------|---------|----------|
| CPU | ≥75% (3 cycles) | ≥90% (3 cycles) |
| Memory | — | <512 MB available |
| Disk | >90% used | >95% used |
| File I/O latency | >20ms | >50ms |
| Blocking | >60s | >300s |
| Unreachable | — | 3 consecutive cycles |

## Docker stack (docker/docker-compose.yml)
- **postgres:17** on port 5432 (persistent pgdata volume)
- **backend** on port 3001 (depends on postgres healthy)
- **frontend** on port 5173 (Vite dev server)
- **nginx** on port 80 — reverse proxy: /api/* → backend, /* → frontend
- Environment config in docker/.env (copy from .env.example)

## When adding a new metric
1. Create /sql/<metric_name>.sql with the exact DMV query
2. Add validation query in comment at top of file
3. Document: source DMV, collection frequency, aggregation type (delta/snapshot),
   units, what to show in UI
4. Add collector function in /server/src/collector/collectors/<metric_name>.ts
5. Add batch insert function in /server/src/collector/worker-pool.ts
6. Add PostgreSQL migration in /server/src/migrations/
7. Add API endpoint in /server/src/routes/
8. Add frontend component in /web/src/components/
