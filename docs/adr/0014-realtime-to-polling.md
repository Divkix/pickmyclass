# Realtime → polling (section states)

**Date:** 2026-08-22. **Status:** Accepted. Phase P5.

## Context

Dashboard used Supabase Realtime `postgres_changes` on `class_states` for live updates. Data only changes when the 30-min cron enqueues `class_nbr` → `processSection()` upserts `class_states`. Realtime added WebSocket infra, Supabase channel lifecycle, and a test seam that was Hyperdrive-incompatible, for a signal that is sparse and cron-aligned.

## Decision

* **Polling replaces Realtime.** `useRealtimeClassStates` now polls `GET /api/class-watches/states?classNumbers=...` on an interval (30–60s, `enabled = classNumbers.length > 0`). `classNumbers` input must be `useMemo`'d (new array each render → infinite loop otherwise). State map keyed by `sectionRefKey` (`term:class_nbr`), not bare `class_nbr`.
* **No Supabase Realtime dependency.** `lib/supabase/client.ts`/`realtime` path deprecated. Polling transport is plain `fetch` (works under Hyperdrive + Clerk, no channel auth).
* **Staleness budget is explicit:** worst-case ~poll interval + cron period (≤31 min). Acceptable for seat alerts (email is the timely channel; dashboard is at-a-glance).

## Why not alternatives

* Keep Realtime via Supabase: keeps Supabase project, incompatible with Hyperdrive-only data plane.
* SSE/WebSocket custom: more infra for same sparse signal; cron already drives freshness.

## Consequences

* `lib/hooks/useRealtimeClassStates.ts` stays named for churn reasons but is polling under the hood; don't re-add `supabase.channel`.
* Admin class-detail watchers already SectionRef-scoped (`get_class_watchers(p_class_nbr,p_term)`); keep polling in sync.
* Tests: mock `global.fetch` for `/api/class-watches/states`, not `supabase.channel`.
* If sub-minute dashboard freshness is later required, revisit with Cloudflare Durable Object fan-out, not Supabase Realtime.
