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
- Backend: Node.js + Fastify 5 + TypeScript (entry: server/src/index.ts)
- Frontend: React 19 + TypeScript + TanStack Query v5 + React Router v7 + Recharts + Tailwind CSS
- Database: PostgreSQL 17 with native partitioning for time-series
- SQL connectivity: mssql (tedious) package
- Auth: JWT + bcrypt (server/src/lib/auth.ts, middleware/auth.ts)
- Deployment: Docker Compose (PostgreSQL + backend + frontend + nginx)
- All in one monorepo
- Environment config: docker/.env (copy from docker/.env.example)

## Project structure
```
/server              — Fastify API + collector scheduler + background jobs
  /src/index.ts        — Entry point: Fastify setup, route registration, scheduler start
  /src/collector/      — scheduler.ts → worker-pool.ts → collectors/*.ts
  /src/routes/         — auth.ts, instances.ts, metrics.ts, alerts.ts, queries.ts, groups.ts, deadlocks.ts, settings.ts, users.ts
  /src/alerts/         — engine.ts (threshold eval), webhook.ts (Slack/Telegram)
  /src/jobs/           — aggregator.ts (5min/hourly rollups), partition-manager.ts
  /src/lib/            — crypto.ts (AES-256-GCM), mssql.ts (connection pool), auth.ts
  /src/migrations/     — SQL files (###_description.sql, e.g. 001_initial.sql) + run.ts executor
/web                 — React frontend (Vite)
  /src/pages/          — Dashboard, Instances, InstanceDetail, QueryExplorer, Alerts, Login, Settings
  /src/components/     — StatusBar, CpuChart, MemoryChart, MemoryBreakdown, SessionBreakdown, SessionsTable, CurrentActivity, WaitsTable, TopWaitsTable, WaitsChart, DeadlocksTable, BlockingTree, FileIoChart, DiskChart, CollapsibleSection, InstanceForm, InstanceCard, OverviewTimeline, AnalysisSection, Layout
  /src/components/settings/ — GroupsSettings, AlertsSettings, RetentionSettings, UsersSettings, AboutSettings
/docker              — Docker Compose stack + nginx config
/sql                 — DMV query library (one .sql file per metric category)
/docs                — architecture decisions, metric specs
```

## Build & development commands
```bash
# Development
docker compose -f docker/docker-compose.yml up -d postgres   # start PostgreSQL
cd server && npm install && npm run dev                       # backend with hot reload (tsx watch)
cd web && npm install && npm run dev                          # frontend Vite dev server (port 5173, proxies /api to :3001)

# Testing
cd server && npx vitest run                  # all backend tests
cd server && npx vitest run src/path/test.ts # single test file
cd web && npx vitest run                     # all frontend tests
cd server && npx vitest                      # watch mode (re-runs on changes)
cd web && npx vitest                         # watch mode

# Build
cd server && npm run build                   # TypeScript → dist/
cd web && npm run build                      # tsc + Vite build
cd web && npm run preview                    # preview production build locally

# Production
cd server && npm start                       # run built server (dist/index.js)

# Database migrations (auto-run on backend startup, or manually)
cd server && npm run migrate                 # run pending migrations manually

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
- No linter or formatter configured — no ESLint, no Prettier
- Frontend path alias: `@/` maps to `web/src/` (configured in tsconfig + vite.config.ts)
- Dependencies: must be MIT/Apache-2.0/BSD licensed — no GPL, SSPL, or BSL (ADR-005)

## Git workflow
- **Commit after each logical block of work** (one feature = one commit). Do NOT squash an entire session into a single commit.
- Use descriptive commit messages: `Add blocking chain visualization` not `Session 11 changes`.
- **After all work is done, rebuild Docker containers** so the user can see UI changes immediately:
  ```bash
  docker compose -f docker/docker-compose.yml up -d --build
  ```
  This is the last step of every session. Do not skip it.

## Collector design
- Worker pool: 40 concurrent workers
- Collection cycle: must complete 200 instances within 30 seconds
- Cycle skipping: if a previous cycle is still running, the next trigger is skipped (no overlap)
- Per-instance: connect → run DMV queries → disconnect → batch insert to PostgreSQL
- Delta metrics (wait_stats, query_stats, file_io, perf_counters): store snapshot in memory,
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

## Collection frequencies
Default cycle interval: 30s (COLLECTOR_INTERVAL_MS). Some metrics skip cycles:
| Metric | Frequency | Type |
|--------|-----------|------|
| active_sessions | 15s | snapshot |
| wait_stats | 30s (every cycle) | delta |
| os_cpu | 30s (every cycle) | snapshot |
| os_memory | 30s (every cycle) | snapshot |
| file_io_stats | 30s (every cycle) | delta |
| perf_counters | 30s (every cycle) | delta (rate) + snapshot (instantaneous), includes dm_os_schedulers Pending Tasks (via scheduler_stats.sql) |
| instance_health | 60s (every 2nd cycle) | snapshot |
| query_stats | 60s (every 2nd cycle) | delta |
| deadlocks | 60s (every 2nd cycle) | snapshot (event-based) |
| os_disk | 5min (every 10th cycle) | snapshot |
| os_host_info | on connect | snapshot |

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
  connection time (lib/mssql.ts). ENCRYPTION_KEY from environment (also used as JWT secret).
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

## API endpoints
- `/health` — healthcheck (no auth)
- `/api/collector/status` — collector cycle status (no auth)
- All other routes under `/api/` require JWT auth (middleware/auth.ts)

## File naming conventions
- SQL reference files: snake_case (`active_sessions.sql`, `wait_stats.sql`)
- TypeScript collector files: kebab-case (`active-sessions.ts`, `wait-stats.ts`)

## Known issues / TODO

1. **Docker rebuild required after code changes** — run `docker compose -f docker/docker-compose.yml up -d --build`
   after any code changes. Hot reload only works in local dev mode (npm run dev).
2. **os_cpu ring_buffer deprecation** — `dm_os_ring_buffers` is deprecated in SQL Server 2025.
   Plan migration to `dm_os_ring_buffer_entries` when adding SQL 2025 support.
3. **Overview Timeline drag-selection** — needs RedGate-style draggable range selector with edge handles and move-window (MATEI-29 area, in progress session 23).
4. **Session Breakdown intermittent empty state** — sometimes shows no data even when active sessions exist (MATEI-29).
