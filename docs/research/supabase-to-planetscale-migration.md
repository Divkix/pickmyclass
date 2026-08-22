# Migration Research: Supabase → PlanetScale Postgres + Clerk

> Researched 2026-08-21 against primary sources (planetscale.com, clerk.com, developers.cloudflare.com, supabase.com docs).
> Repo-side inventory: 18 distinct RPCs across 8 files; 5 tables via `.from()`; ~21 live SECURITY DEFINER functions; 50 migrations; one Realtime site (`lib/hooks/useRealtimeClassStates.ts`); 3 Supabase client flavors with ~32 importer edges; ~31 test files mock `@/lib/supabase/*`; secrets `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SEND_EMAIL_HOOK_SECRET`.

## 1. Target platform — PlanetScale Postgres

| Fact | Value | Source |
|---|---|---|
| PS-5 non-HA | $5/mo, 1/16 vCPU, 512 MiB, single node, no replicas/failover | https://planetscale.com/pricing, /blog/5-dollar-planetscale-is-here |
| PS-5 HA | $15/mo, primary + 2 replicas across 3 AZs | same |
| Storage | First 10 GB included; autoscaling on NAS clusters | https://planetscale.com/docs/postgres/pricing |
| Egress | PS-5 non-HA prod: **10 GB/mo** included (HA prod: 100 GB) | same |
| Backups | Every 12h, 2-day retention, PITR ≥5 min within window; backup storage = 2× disk | https://planetscale.com/docs/postgres/backups |
| Compatibility | Vanilla PG 17/18: functions, triggers, FKs, partial indexes, logical replication all supported. No SUPERUSER (default role near-superuser incl. BYPASSRLS) | https://planetscale.com/docs/postgres/postgres-compatibility |
| Extensions | Curated list only; **pgTAP NOT supported** → `supabase/tests/*.test.sql` become local-only tests (supabase CLI docker). Core-PG-only schema needs nothing else | https://planetscale.com/docs/postgres/extensions |
| PgBouncer | Local bouncer port **6432**, transaction pooling ONLY; named prepared statements OK (`max_prepared_statements=200`); **LISTEN/NOTIFY not usable through pooling**; direct 5432 for DDL/long ops | https://planetscale.com/docs/postgres/connecting/pgbouncer |
| max_connections | Unpublished per-tier default — read live via Clusters → Parameters or `SHOW max_connections` | https://planetscale.com/docs/postgres/connecting |
| Branching | Isolated DBs; empty branch does NOT copy schema; **no deploy requests, no automated schema merge** — keep authoritative migrations in repo, apply per-branch manually | https://planetscale.com/docs/postgres/branching |

### Import path from Supabase
Official guide: https://planetscale.com/docs/postgres/imports/supabase
1. Enable Supabase **IPv4 add-on** (direct connection; possible brief downtime).
2. `ALTER ROLE <role> SET statement_timeout = 0;` before copy (else WAL/disk buildup on source).
3. Dump schema: `pg_dump --schema-only --no-owner --no-privileges --schema=public` → load into PlanetScale.
4. `CREATE PUBLICATION replicate_to_planetscale FOR TABLE ...` on Supabase; `CREATE SUBSCRIPTION ... WITH (copy_data = true)` on PlanetScale.
5. Monitor `pg_subscription_rel` until `ready`; compare LSNs.
6. **Advance all sequences (`setval`) before cutover** — logical replication does not sync them.
7. Works from a separate migration instance; `pgcopydb --follow` is the maintained alternative (auto sequence reset).

Single-node caveat: subscription/slot state is lost on node failure (re-sync needed); positioned as dev/small-prod tier.

## 2. Auth replacement — Clerk

### User migration (passwords survive)
- Official tool: https://github.com/clerk/migration-tool with a **built-in Supabase exporter**: `bun export:supabase --db-url <direct-postgres-url>` reads `auth.users` **including bcrypt `encrypted_password`** (not exposed via Admin API), then `bun migrate --transformer supabase`. https://raw.githubusercontent.com/clerk/migration-tool/main/docs/exporting-users.md
- Backend API `createUser` accepts `passwordDigest` + `passwordHasher: "bcrypt"` (+`externalId`, verified emails, `createdAt` backdating). Rate limit prod 1000 req/10s; tool defaults 100 rps ≈ 3,500 users in ~35 s, idempotent by email, resumable. https://clerk.com/docs/reference/backend/user/create-user
- Imported hashes transparently upgrade to Clerk's bcrypt on first sign-in.

### Google OAuth identities cannot be imported
Each Google user re-authenticates once post-cutover; Clerk **account linking** merges the new OAuth identity automatically when the provider returns a *verified* email matching the imported account (imported emails are verified-by-default). https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking
→ Set `externalId` = old Supabase UUID at import so legacy IDs survive everywhere.

### Workers integration — use `@clerk/backend`, NOT `@clerk/nextjs`
- `@clerk/backend` officially supports "any V8 isolates runtime" (Cloudflare Workers first-class). https://clerk.com/docs/guides/development/sdk-development/backend-only
- `@clerk/nextjs` assumes real Next.js conventions and its Next 16 `proxy.ts` guidance targets Node runtime; vinext runs its proxy in workerd → **build the gate on `authenticateRequest()` / `verifyToken()` (PEM `jwtKey` = networkless)** + `@clerk/clerk-react` `<ClerkProvider>` client-side. JWKS endpoint `/v1/jwks` is rate-limit-free. https://clerk.com/docs/reference/backend/verify-token
- Session-token custom claims: ≤1.2 KB, refresh lag up to 60 s → do NOT put volatile authorization state in JWT claims; keep the existing `user_profiles`-backed authorization-state module and only swap identity resolution to Clerk user ID. https://clerk.com/docs/guides/sessions/customize-session-tokens

### Webhook-driven users mirror (replaces auth.users joins)
- Svix webhooks; verify via `verifyWebhook(request)` (`@clerk/backend/webhooks`, Standard Webhooks). Events: `user.created`/`user.updated`/`user.deleted`. Return 2xx fast; retries automatic; dashboard replay exists. https://clerk.com/docs/guides/development/webhooks/syncing
- This feeds the local `users` table that ~10 SECURITY DEFINER functions currently get emails from via `auth.users`.

### Pricing & email delivery
- Hobby free: 50k MRU/app. Pro $25/mo ($20 annual), overage $0.02/MRU (50k–100k), then volume discounts. Custom email templates are Pro-only. https://clerk.com/pricing
- Self-delivered auth email = disable "Delivered by Clerk" per template + handle `email.created` webhook (contains `otp_code`); available on Hobby. No literal SMTP config documented. https://clerk.com/docs/guides/development/troubleshooting/email-deliverability

### CSP additions required (proxy.ts)
script-src/connect-src: FAPI host (`*.clerk.accounts.dev` dev / custom FAPI prod), `https://challenges.cloudflare.com`, `https://*.protect.clerk.com:*` (**trailing `:*` mandatory** in connect-src); img-src `https://img.clerk.com`; style-src `'unsafe-inline'` (runtime CSS-in-JS); frame-src challenges.cloudflare.com + protect hosts; worker-src `'self' blob:`. Auto-injection is Next-SDK-only → we set headers manually in proxy.ts. https://clerk.com/docs/guides/secure/best-practices/csp-headers

## 3. Data access — Cloudflare Hyperdrive

- **Official Cloudflare × PlanetScale partnership page + step-by-step guide exist**; can even provision/bill PlanetScale from the CF dashboard. Use `node-postgres (pg)` or postgres.js directly — **never the PlanetScale serverless HTTP driver behind Hyperdrive**. https://developers.cloudflare.com/hyperdrive/planetscale/, https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/planetscale-postgres/
- Setup: `wrangler hyperdrive create <NAME> --connection-string="postgres://...planetscale..." [--caching-disabled]` → bind in wrangler.jsonc (`hyperdrive: [{binding, id}]`). Origin creds live in Hyperdrive config, never in Worker env. Requires `nodejs_compat`.
- Driver: **pg ≥ 8.16.3 recommended**; postgres.js ≥ 3.4.5 with `{max: 5, fetch_types: false, prepare: true}` (keep prepared statements ON for cacheability).
- ⚠️ **Query caching has NO write invalidation** (default 60 s max_age). The seat-check pipeline does read-modify-write on `class_states` → route pipeline/auth paths through a **`--caching-disabled` config**; optional second cached config later for admin dashboards. https://developers.cloudflare.com/hyperdrive/concepts/query-caching/
- Pooling: transaction mode; connections RESET between uses; per-request client creation is cheap/recommended; avoid long transactions. Limits: ~20 origin conns (Free) / ~100 (Paid), 60 s max query, 15 s connect timeout. https://developers.cloudflare.com/hyperdrive/platform/limits/
- Pricing: included Free+Paid plans; unlimited queries on Paid. https://developers.cloudflare.com/hyperdrive/platform/pricing/
- Local dev without prod creds: `wrangler dev` bypasses Hyperdrive; set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING>` env var pointing at any local PG (docker). https://developers.cloudflare.com/hyperdrive/configuration/local-development/
- Raw TCP via `cloudflare:sockets` IS technically possible but unrecommended (no pooling) — Hyperdrive is the correct path. https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/

## 4. Source export — Supabase specifics

- `auth.users`: `email`, `email_confirmed_at`, `encrypted_password` (**bcrypt**), `raw_user_meta_data` (holds consent metadata read by `handle_new_user`), `created_at`, `last_sign_in_at`. Queryable via SQL Editor or dumped over a **direct connection** (pooled endpoints unsuitable for dumps/replication). https://supabase.com/docs/guides/auth/managing-user-data
- `auth.identities` holds the Google links (provider, provider_id) — informational for reconciliation; identities themselves are re-created by Clerk account linking.
- Deleting users doesn't kill issued JWTs until `exp` — expect a short window of valid Supabase tokens after cutover; acceptable since API routes will reject unknown sessions once Clerk is authoritative.
- Clerk's exporter handles this step end-to-end (needs the direct Postgres URL).

## 5. Locked architecture decisions

1. **DB**: PlanetScale PS-5 (owner confirms non-HA vs HA $15) via **Hyperdrive** (`--caching-disabled` config for correctness-critical paths).
2. **Driver**: `pg` ≥ 8.16.3 behind `env.HYPERDRIVE.connectionString`; per-request clients; existing SECURITY DEFINER RPCs stay as SQL functions called via parameterized `SELECT * FROM fn($1, ...)`.
3. **Auth**: `@clerk/backend` (edge verification w/ PEM jwtKey) + `@clerk/clerk-react` UI components. `decideGate()` inputs unchanged; identity resolution swaps Supabase session → Clerk session claims; `user_profiles` remains authorization source of truth.
4. **Users mirror**: local `users` table (PK = string; migrated rows keyed by old Supabase UUID via Clerk `externalId`), synced by Clerk webhooks; retarget FKs + rewrite ~10 SD function joins from `auth.users` → `users`.
5. **Realtime → polling** of an authenticated `/api/class-watches/states` endpoint (data changes only every 30 min cron anyway); drop REPLICA IDENTITY FULL concern.
6. **Migrations workflow**: plain ordered `.sql` files remain canonical (supabase CLI dropped); apply per-branch manually; pgTAP tests stay local-docker-only.
7. Lockout (`failed_login_attempts`), anti-enumeration signup semantics, consent gate, WAF rule on `check-lockout`, unsubscribe HMAC: all app-owned, unchanged.

## 6. Phased plan

| Phase | Work (targets) | Owner | Est. |
|---|---|---|---|
| P0 Bootstrap | Owner creates accounts/instances (see §7); I spike `@clerk/backend` `authenticateRequest` under vinext/workerd + Hyperdrive local-dev wiring | Joint | 1–2d |
| P1 Schema port | New vanilla-PG migration set: strip RLS/grants (app-layer authz), add `users` mirror + webhook-sync support, retarget FKs from `auth.users`, rewrite SD functions' joins, drop `on_auth_user_created` trigger (replaced by webhook upsert), keep dedup partial unique index + `(class_nbr,term)` | Me | 3–4d |
| P2 Data pipeline rehearsal | Run PlanetScale import guide against staging dump; sequence `setval`s; row-count + checksum verification scripts | Me (needs creds) | 1–2d |
| P3 Data layer swap | Replace `lib/supabase/{client,server,service}.ts` with Hyperdrive-backed query seam; rewrite 18 RPC call sites (`lib/db/queries.ts`, `lib/db/admin-queries.ts`, queue/auth callers); replace `database.types.ts` typing strategy; update `lib/types/env.ts`, `wrangler.jsonc`, CSP cookie-shape checks in `lib/worker/edge-html-cache.ts` | Me | 4–6d |
| P4 Clerk integration | `proxy.ts` gate → `authenticateRequest` + decideGate; rewrite `app/api/auth/*` (register/login/signout/check-lockout/consent), delete `send-email-hook`; `/auth/callback` rework; login/register/forgot/reset/verify pages → clerk-react; add webhook sync route; admin user-detail page replaces `auth.admin.getUserById` with mirror read; user import run | Me (needs keys) | 4–6d |
| P5 Polling swap | Rewrite `lib/hooks/useRealtimeClassStates.ts` → interval fetch + SWR-style cache | Me | 0.5–1d |
| P6 Tests & docs | Rework ~31 test files mocking supabase clients; keep pgTAP suite local-docker; new ADRs (auth boundary, data access); update CLAUDE.md/AGENTS.md/README drift | Me | 3–5d |
| P7 Cutover | Freeze writes → final sync check → sequence setvals → Clerk import → deploy → smoke test → unfreeze; Supabase kept read-only fallback for N days | Joint | 0.5–1d window |

Total ≈ 17–27 eng-days (~3.5–5 weeks) excluding owner-latency.

## 7. What I need from you (manual)

**Blocking start of implementation (P0):**
- [ ] Create PlanetScale org + Postgres database (region near your Worker placement) — choose **PS-5 non-HA ($5)** vs **PS-5 HA ($15)**; share a service-role-ish connection string (or create the Hyperdrive binding yourself via the wrangler command I provide).
- [ ] Create Clerk production instance; send publishable + secret keys; pick plan (Hobby likely sufficient — confirm your MAU).
- [ ] Tell me current **total users** and **monthly active users**, plus rough **DB size** (validates PS-5 10 GB storage / egress headroom).

**Google OAuth cutover (can be done anytime before P7):**
- [ ] In Google Cloud Console → your existing OAuth client: add Clerk's authorized redirect URI (shown in Clerk dashboard) alongside the old Supabase one; branding/consent screen stays as-is.

**Supabase side (needed for export/replication):**
- [ ] Enable the **IPv4 add-on** on Supabase (dashboard warns of possible brief downtime — schedule accordingly).
- [ ] Provide (or run yourself) the **direct** Postgres connection URL used by Clerk's exporter and the replication setup.

**Cutover decisions (P7):**
- [ ] Approve maintenance window; confirm whether auth emails should be Clerk-delivered (default) or self-delivered via `email.created` webhook → your existing CF Email binding.
- [ ] Final go/no-go; DNS/deploy approval.

Everything else — schema migrations, code changes, tests, docs, rehearsals, local verification — I execute autonomously.

## 8. Risks & open items

- **vinext × clerk-react rendering**: unverified combo (no official statement); spike in P0 gates Phase 4 approach. Worst case: hand-rolled auth UI calling Backend API directly.
- **CSP vs clerk-react styles**: `'unsafe-inline'` in style-src weakens current strict-nonce CSP; mitigation options scoped during P4 (isolate Clerk components to auth pages).
- **PS-5 headroom**: 512 MB RAM, 1/16 vCPU, single node; semester-start spikes or growth require the $15 HA / larger SKU. `max_connections` must be read live after instance creation.
- **Stale-session window**: Supabase JWTs stay valid until `exp` after cutover — short-lived, accepted.
- **Sequence sync**: any `bigserial` columns need explicit `setval` pre-cutover (checklist item in P7).
- Region pricing varies (quoted AWS us-east-1); confirm at creation time.
