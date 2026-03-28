---
name: Test coverage audit 2026-03-28
description: Full audit of test coverage gaps across Matei codebase - identifies untested files and prioritized work items
type: project
---

Full test coverage audit completed 2026-03-28.

**Top gaps identified:**
1. `server/src/alerts/webhook.ts` -- COVERED (16 tests added 2026-03-28). Payload format, URL caching with TTL, env fallback, error handling, early exit.
2. `web/src/lib/auth.ts` -- COVERED (17 tests added 2026-03-28). Token storage, authFetch with 401 auto-refresh, login success/error, logout redirect.
3. `web/src/lib/theme.ts` -- COVERED (13 tests added 2026-03-28). useTheme hook: initial selection, stored/system preference, toggle persistence, DOM class, system change listener.
4. `web/src/lib/chart-utils.ts` -- `generateTicks` function untested.
5. `web/src/components/DiskUsage.tsx` -- COVERED (12 tests added 2026-03-28). Loading/empty/error states, disk label formatting, size formatting (MB/GB/TB), sort order, API params.
6. `server/src/__tests__/crypto.test.ts` -- Duplicate of `__tests__/lib/crypto.test.ts` (older, fewer tests).
7. `collectFileIoStats` and `collectPerfCounters` integration-level collect functions not tested (only their `compute*` pure functions).
8. Auth routes: refresh token success path not tested.
9. `server/src/collector/scheduler.ts` -- COVERED (21 tests added 2026-03-28). Lifecycle, cycle skipping, interval timing, error handling, status tracking.

**Why:** Alert delivery and auth are the two highest-risk areas. A webhook.ts bug causes silent alert loss. An auth.ts bug breaks all user sessions.

**How to apply:** Remaining gaps are lower priority: generateTicks, collector integration tests, duplicate crypto test cleanup, auth route refresh path.
