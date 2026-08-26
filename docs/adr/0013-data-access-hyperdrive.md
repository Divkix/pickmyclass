# Data plane: PlanetScale Postgres via Hyperdrive + Drizzle/postgres-js (seam, not PostgREST)

**Date:** 2026-08-22. **Status:** Accepted. Phase P0 spike verified; P1–P3 parallel to auth.

## Context

Supabase was Postgres + PostgREST + Realtime over HTTP. Moving to PlanetScale (PS-5) for cost/region choice while keeping SQL surface (vanilla PG→PG easy, trust model hard). Need edge data access from `workerd` with safe pooling, no Hyperdrive cache stale reads for writes, and no rewrite of 21 `SECURITY DEFINER` functions.

## Decision

* **Hyperdrive is the only DB binding.** `wrangler.jsonc` `hyperdrive` → the `HYPERDRIVE` binding. Binding id `749d7808617942ceabbca1059710fbbf`. Config `--caching-disabled` (no stale reads; Hyperdrive cache has no write invalidation).
* **Driver is Drizzle ORM over `postgres` (postgres-js).** `lib/db/index.ts` exposes `getDb(hyperdrive)` plus the server-only `getDbFromEnv()` (reads `env.HYPERDRIVE` from `cloudflare:workers`); each request/page/queue/scheduled entry point creates ONE request-scoped handle and passes it to lower helpers — no global Pool and no connection-string registration. Local dev resolves through wrangler's Hyperdrive simulation (`localConnectionString` in `wrangler.jsonc`, overridable via `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`). `lib/db/queries.ts` and `lib/db/admin-queries.ts` keep RPC-first access: Drizzle builders for table CRUD/upserts/transactions, and typed `sql` fragments via `db.execute` for `SELECT * FROM security_definer_fn(…)` with bound parameters, so filtering/joins stay in SQL and service role can read emails out of the `auth.users`-equivalent mirror.
* **SQL functions stay.** 50 migrations applied in order; last definition wins. Sensitive `SECURITY DEFINER` functions `SET search_path = public` + `REVOKE EXECUTE FROM PUBLIC/anon/authenticated` → `GRANT EXECUTE TO service_role`. `class_states` keyed `(class_nbr, term)` everywhere.
* **No Supabase PostgREST.** `@supabase/supabase-js` + `@supabase/ssr` deprecated (knip `ignoreDependencies`, `lib/supabase/*` ignored). `lib/supabase/database.types.ts` regenerated only if migrations still need types; `lib/cloudflare-env.d.ts` from `pnpm cf-typegen`, secrets hand-typed in `lib/cloudflare-env.supplemental.d.ts`.

## Why not alternatives

* Supabase HTTP + Hyperdrive: still needs Supabase project, adds PostgREST latency.
* Neon HTTP driver: extra dep, SQL function surface still needs pool semantics.
* Hyperdrive with caching on: risks write-then-read stale (upsert `class_states` before send would re-send on retry).

## Consequences

* `db/migrations/20260822000000_planetscale_schema.sql` adds `users.clerk_user_id TEXT UNIQUE`; the Drizzle schema (`lib/db/schema/`, with `$inferSelect` row types) mirrors it.
* `lib/db/index.ts` is the single seam; all callers create/pass a request-scoped `Database` via `getDb()`/`getDbFromEnv()` or use the typed-query helpers — never raw SQL clients. Tests alias `cloudflare:workers` via `tests/mocks/cloudflare-workers.ts` and inject the `HYPERDRIVE` binding.
* Ops: `wrangler hyperdrive create` once (owner manual checklist #353), then `HYPERDRIVE` binding only; no `SUPABASE_*` vars in `wrangler.jsonc` or secrets.
* Cutover: pre-freeze `received_lsn` vs `pg_current_wal_lsn()`, freeze, `setval` sequences, `bun migrate` import, deploy with `HYPERDRIVE` + `CLERK_*` secrets, keep Supabase read-only N≥14 days before dropping publication/subscription; rollback is repoint `HYPERDRIVE` + revert Clerk secrets (data loss window = freeze-to-cutover).
