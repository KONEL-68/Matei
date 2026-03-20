# Matei

Self-hosted SQL Server monitoring platform. Pull-based architecture — nothing installed on your servers.

## Features

- **200+ instances** monitoring from a single central server
- **No agents** — connects directly via TDS protocol, reads DMVs remotely
- **No objects on target** — no databases, jobs, or stored procedures on monitored servers
- **Web dashboard** — fleet overview with real-time CPU, memory, and status per instance
- **Instance detail** — CPU/memory charts, wait stats breakdown, active sessions, time range selector
- **Query Explorer** — top queries by CPU/reads/duration with on-demand execution plan retrieval
- **Real-time alerts** — CPU, memory, disk, I/O latency, blocking thresholds with webhook delivery (Telegram, Slack)
- **Historical data** — 7d raw, 30d aggregated (5-min), 1y hourly
- **Dark mode** — full dark/light theme support
- **Authentication** — JWT-based login with bcrypt password hashing

## Architecture

- **Backend:** Node.js + Fastify + TypeScript
- **Frontend:** React + TypeScript + TanStack Query + Recharts + Tailwind CSS
- **Storage:** PostgreSQL 17 with native daily partitioning for time-series data
- **Deployment:** Docker Compose (PostgreSQL + backend + frontend + nginx reverse proxy)

## Metrics Collected

| Metric | Source DMV | Frequency | Type |
|--------|-----------|-----------|------|
| Instance Health | SERVERPROPERTY + dm_os_sys_info | 60s | Snapshot |
| Wait Stats | dm_os_wait_stats | 30s | Delta |
| Active Sessions | dm_exec_sessions + dm_exec_requests | 15s | Snapshot |
| Query Performance | dm_exec_query_stats | 60s | Delta |
| CPU (SQL + OS) | dm_os_ring_buffers | 30s | Snapshot |
| Memory (SQL + OS) | dm_os_sys_memory + dm_os_process_memory | 30s | Snapshot |
| File I/O | dm_io_virtual_file_stats | 30s | Delta |
| Disk Space | dm_os_volume_stats | 5min | Snapshot |
| OS Host Info | dm_os_host_info | On connect | Snapshot |

## Permissions Required

On each monitored SQL Server instance:

```sql
CREATE LOGIN [matei_monitor] WITH PASSWORD = 'your_password';
CREATE USER [matei_monitor] FOR LOGIN [matei_monitor];

GRANT VIEW SERVER STATE TO [matei_monitor];
GRANT VIEW ANY DATABASE TO [matei_monitor];
```

No sysadmin. No db_owner. No SQL Agent.

## Quick Start

```bash
# Clone
git clone https://github.com/KONEL-68/Matei.git
cd Matei

# Copy environment config
cp docker/.env.example docker/.env
# Edit docker/.env — set ENCRYPTION_KEY (openssl rand -hex 32) and passwords

# Start full stack
docker compose -f docker/docker-compose.yml up --build
# Open http://localhost
```

### Local Development

```bash
# Start PostgreSQL only
docker compose -f docker/docker-compose.yml up -d postgres

# Backend (hot reload on port 3001)
cd server && npm install && npm run dev

# Frontend (Vite dev server on port 5173)
cd web && npm install && npm run dev
```

### Running Tests

```bash
cd server && npx vitest run    # backend tests
cd web && npx vitest run       # frontend tests
```

## Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| CPU | ≥75% (3 cycles) | ≥90% (3 cycles) |
| Memory | — | <512 MB available |
| Disk | >90% used | >95% used |
| File I/O latency | >20ms | >50ms |
| Blocking | >60s | >300s |
| Unreachable | — | 3 consecutive failures |

## License

MIT
