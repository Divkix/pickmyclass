# Schema migrations run through drizzle-kit

**Date:** 2026-10-01. **Status:** Accepted. Supersedes the "SQL functions stay … last definition wins" migration note in `0013-data-access-hyperdrive.md`.

## Context

`db/migrations/*.sql` (53 hand-written files) was applied by hand with `psql`. Nothing recorded which files had run, and `lib/db/schema/` was a hand-kept mirror that could drift from prod unnoticed. Cloudflare's Hyperdrive + Drizzle guide and clickfolio.me both use `drizzle-kit generate` + `drizzle-kit migrate` over a direct connection.

## Decision

- **`lib/db/schema/` is the source of truth for tables.** `pnpm run db:generate` diffs it against `migrations_pg/meta/` snapshots and writes SQL.
- **Functions, triggers and data fixes** go in `db:generate -- --custom` files. drizzle-kit does not model them.
- **`pnpm run db:migrate` applies pending files** and records them in `drizzle.__drizzle_migrations`. It uses the direct PlanetScale `DATABASE_URL`, never Hyperdrive (drizzle-kit runs in Node). `pnpm run deploy` runs it after the build and before `wrangler deploy`.
- **Baseline:** `0000_baseline` (tables, generated) + `0001_baseline_functions` (custom; `private` schema, 23 functions, 1 trigger, dumped with `pg_get_functiondef`). Applied to an empty Postgres 18, they match prod's columns, constraints, indexes, function bodies, triggers and ACLs exactly. Prod has both rows inserted into `drizzle.__drizzle_migrations` without running them.
- **`db/migrations/` is frozen** history. Nothing reads it.

## Consequences

- Migrations run inside one transaction per `migrate` call; a failed file rolls back the batch and aborts the deploy before `wrangler deploy`.
- Schema changes must be backwards-compatible with the Worker version still serving traffic until `wrangler deploy` finishes (add first, drop in a later release).
- Deploying needs `DATABASE_URL` in the shell.
