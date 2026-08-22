# Data plane: PlanetScale Postgres via Hyperdrive + pg (seam, not PostgREST)

**Date:** 2026-08-22. **Status:** Accepted. Phase P0 spike verified; P1–P3 parallel to auth.

## Context

Supabase was Postgres + PostgREST + Realtime over HTTP. Moving to PlanetScale (PS-5) for cost/region choice while keeping SQL surface (vanilla PG→PG easy, trust model hard). Need edge data access from `workerd` with safe pooling, no Hyperdrive cache stale reads for writes, and no rewrite of 21 `SECURITY DEFINER` functions.

## Decision

* **Hyperdrive is the only DB binding.** `wrangler.jsonc` `hyperdrive` → `env.HYPERDRIVE.connectionString`. Binding id `4dd6f092...`. Config `--caching-disabled` (no stale reads; Hyperdrive cache has no write invalidation).
* **Driver is `pg` 8.23 (`node-postgres`).** `lib/db/client.ts` owns a 5-conn `Pool`, `setConnectionStringGetter` via `registerHyperdrive` inside `worker.ts` handlers (not module top-level, so `wrangler dev` local fallback uses `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`). `lib/db/queries.ts` and `lib/db/admin-queries.ts` keep RPC-first access: `SELECT * FROM security_definer_fn($1,…)` via parameterized queries, so filtering/joins stay in SQL and service role can read emails out of `auth.users`-equivalent mirror.
* **SQL functions stay.** 50 migrations applied in order; last definition wins. Sensitive `SECURITY DEFINER` functions `SET search_path = public` + `REVOKE EXECUTE FROM PUBLIC/anon/authenticated` → `GRANT EXECUTE TO service_role`. `class_states` keyed `(class_nbr, term)` everywhere.
* **No Supabase PostgREST.** `@supabase/supabase-js` + `@supabase/ssr` deprecated (knip `ignoreDependencies`, `lib/supabase/*` ignored). `lib/supabase/database.types.ts` regenerated only if migrations still need types; `lib/cloudflare-env.d.ts` from `pnpm cf-typegen`, secrets hand-typed in `lib/cloudflare-env.supplemental.d.ts`.

## Why not alternatives

* Supabase HTTP + Hyperdrive: still needs Supabase project, adds PostgREST latency.
* Neon HTTP driver: extra dep, SQL function surface still needs pool semantics.
* Hyperdrive with caching on: risks write-then-read stale (upsert `class_states` before send would re-send on retry).

## Consequences

* `supabase/migrations/20260822000000_planetscale_schema.sql` adds `users.clerk_user_id TEXT UNIQUE`; `lib/db/types.ts` mirrors.
* `lib/db/client.ts` is the single seam; all callers import `getDb()` or RPC helpers, never raw `pg`. Tests alias Hyperdrive via `tests/mocks/cloudflare-workers.ts` and inject `HYPERDRIVE` binding.
* Ops: `wrangler hyperdrive create` once (owner manual checklist #353), then `HYPERDRIVE` binding only; no `SUPABASE_*` vars in `wrangler.jsonc` or secrets.
* Cutover: pre-freeze `received_lsn` vs `pg_current_wal_lsn()`, freeze, `setval` sequences, `bun migrate` import, deploy with `HYPERDRIVE` + `CLERK_*` secrets, keep Supabase read-only N≥14 days before dropping publication/subscription; rollback is repoint `HYPERDRIVE` + revert Clerk secrets (data loss window = freeze-to-cutover).
