# Architecture Decisions

## ADR-001: Pull model, no agents
We connect from central server to each SQL Server. No agents deployed.
Reason: managing agents on 200+ servers is operationally expensive.

## ADR-002: No objects on target servers
Unlike PerformanceMonitor Full, we do NOT install databases, jobs, or stored
procedures on monitored servers. We only read DMVs remotely.
Exception: XE sessions may be recommended for deadlock/blocking capture,
but are optional and documented separately.

## ADR-003: PostgreSQL for storage
Time-series data stored in PostgreSQL with native range partitioning by day.
TimescaleDB not required to avoid licensing complications for commercial use.

## ADR-004: Delta computation in collector, not DB
Wait stats and query stats deltas computed in the collector service
(in-memory previous snapshot), not via SQL window functions on stored data.
Reason: less storage, simpler queries, real-time accuracy.

## ADR-005: No paid dependencies
All dependencies must be MIT/Apache-2.0/BSD licensed.
No GPL (viral), no SSPL, no BSL. Check before adding any new dependency.
This ensures the product can be sold commercially without licensing issues.

## ADR-006: Credentials encrypted at rest
Instance credentials stored in PostgreSQL encrypted with AES-256-GCM.
Encryption key provided via environment variable, never hardcoded.
