# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Fleet dashboard with instance health cards, CPU/memory bars, top waits
- Instance management (add/edit/delete/test connection)
- 8 metric collectors: instance health, wait stats, active sessions, OS CPU, OS memory, disk space, file I/O, query stats
- Worker pool with configurable concurrency (default 40 workers)
- Alert engine with threshold-based alerts (CPU, memory, disk, I/O, blocking, unreachable)
- Webhook alert delivery
- Instance detail page with CPU/memory charts, waits table, sessions table
- Time range picker (1h/6h/24h/7d/30d/1y)
- Data retention: partition manager (7d raw, 30d 5min, 1y hourly)
- Aggregation jobs (raw → 5min → hourly rollups)
- AES-256-GCM credential encryption
- Docker Compose deployment (PostgreSQL + backend + frontend + nginx)
- Dark mode with system preference detection and manual toggle
- JWT-based authentication with access/refresh tokens
- Auto-created admin user from environment variables on first startup
- Login page with token auto-refresh on 401
- Query Explorer page with top queries by CPU/reads/duration/executions
- On-demand execution plan retrieval (XML) from SQL Server
- Query stats collector with delta computation (runs every 60s)
