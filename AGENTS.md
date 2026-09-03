# Repository Guidelines

> **Audience: AI coding agents and contributors.** This file is the onboarding map for working in this repo. Read it before touching code — it explains how the system works, how it's built and tested, and the invariants you must not break.

## Keeping this file current

When you discover something non-obvious — an invariant, gotcha, decision and its *why* — **record it here and consolidate**: merge into closest existing point, delete what your change made false, keep entries terse. One deduplicated map, not an append-only log. Don't record transient state or secrets. When doc and code disagree, code wins.

> `AGENTS.md` is canonical. Former `CLAUDE.md` symlink removed — `AGENTS.md` is the source (add `CLAUDE.md -> AGENTS.md` symlink if you need Claude Code compatibility).

## Agent skills

- **Issue tracker:** GitHub Issues on `Divkix/pickmyclass` via `gh` CLI. See `docs/agents/issue-tracker.md`.
- **Triage labels:** `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.
- **Domain docs:** `CONTEXT.md` + `docs/adr/` at root. See `docs/agents/domain.md`.

## What this is

**PickMyClass** notifies ASU students by email when a seat opens or instructor is assigned in a watched section. **Next.js 16 App Router** (React 19, TS strict) on **Cloudflare Workers via `vinext`** (Vite-based, not next-on-pages), **PlanetScale Postgres via Hyperdrive** (request-scoped Drizzle/postgres-js, `--caching-disabled`) + **Clerk** (`jwtKey`, `ext_id`) + **polling** (`docs/adr/0014`), **Cloudflare Email + Queues + Durable Object** for notifications. `pnpm@11.10.0`, `Vite+ (vp)`.

Two systems to understand first: **seat-check notification pipeline** and **auth/account lifecycle** — details in ADRs, invariants below.

## Architecture at a glance

```
Browser -> vinext Worker (worker.ts) -> PlanetScale via Hyperdrive (polling)
             |  Cron 0,30 * * * * + 0 4 * * * -> worker.ts scheduled() -> /api/cron -> Queue -> worker.ts queue() -> processSection() -> ASU API + Email
             |  Clerk FAPI (jwtKey verify)    -> polling GET /api/class-watches/states
```

Queue consumer `worker.ts queue()` calls `processSection()` directly (not HTTP); `app/api/queue/process-section/route.ts` is a mirror for tests. See `docs/adr/0006`.

## Core systems (pointers, not copies)

- **Seat-check pipeline:** `worker.ts` + `app/api/cron/route.ts` + `lib/queue/process-section.ts` + `lib/asu/api.ts` + `lib/db/queries.ts` + `lib/email/`. Flow: Cron -> CronLockDO (25min lease) -> `getSectionsToCheck` (even/odd stagger) -> Queue (batch 100, one retry) -> `processSection()` (read baseline -> fetch ASU -> detectChanges -> first-observation guard -> upsert class_states before send -> notify). Full ordering and dedup in `docs/adr/0004`, `0006`, `0011`.
- **Auth:** Clerk hosted `<SignIn>/<SignUp>` at `/sign-in`/`/sign-up` (`lib/clerk/config.ts` literal key). Sessions via `lib/auth/clerk-session.ts` (`ext_id` claim), `lib/auth/clerk-cookies.ts`, `proxy.ts` gate + `lib/auth/decide-gate.ts`. Webhook `POST /api/webhooks/clerk` -> `lib/db/users.ts` mirror. See `docs/adr/0012`, `0001`.
- **Data:** Single seam `lib/db/index.ts` (`getDb(hyperdrive)` request-scoped). RPC-first (`SECURITY DEFINER` functions). `class_states` unique on `(class_nbr, term)`. `user_profiles` 1:1 mirror. See `docs/adr/0013`.

## Project structure

```
app/          # Routes, pages, API endpoints (App Router)
lib/          # Core logic (asu/, api/, auth/, clerk/, class-watches/, db/, queue/, worker/, email/, cache/, hooks/, contexts/, types/, blog/)
components/   # React (ui/, admin/, landing/, blog/)
tests/        # unit/, integration/, mocks/
worker.ts     # CF Worker (fetch, scheduled, queue, CronLockDO)
proxy.ts      # vinext middleware — THE auth gate + CSP nonce
db/migrations/ # timestamped SQL history (plain PG)
public/       # static + llms.txt, llms-full.txt
```

`lib/utils.ts` = shadcn `cn()` only; `lib/utils/` = custom utils — by design, don't deduplicate.

## Cloudflare Workers runtime

- `worker.ts` wraps vinext + `scheduled`/`queue`/`CronLockDO` (`lib/worker/cron-lock.ts`). Keep DO exports and `wrangler.jsonc` migration `v2` aligned.
- Bindings `wrangler.jsonc` + `lib/types/env.ts`: `HYPERDRIVE`, `PICKMYCLASS_QUEUE` -> `pickmyclass-queue` + DLQ `pickmyclass-dlq`, `PICKMYCLASS_CRON_LOCK_DO`, `EMAIL`, `ASSETS`, `CF_VERSION_METADATA`. Vars: `MAX_WATCHES_PER_USER` (10).
- Secrets via `wrangler secret put` (never in jsonc): `CLERK_*`, `ASU_API_*`, `CRON_SECRET`, `UNSUBSCRIBE_SIGNING_SECRET`.
- Access bindings via `import { env } from 'cloudflare:workers'` + `as unknown as Env`.
- Config: `main ./worker.ts`, `compatibility_date 2026-05-07`, `placement: smart`, stateless, 128MB, 30s HTTP / 15min cron. Always `pnpm run preview` before deploy.

## Build, test & dev

Through `vinext` + `vp` — don't use `next`/`vitest`/`eslint` directly. `pnpm@11.10.0`.

```bash
pnpm run dev              # vinext dev :3000
pnpm run build
pnpm run preview          # real Worker locally
pnpm run deploy           # build + wrangler deploy + triggers deploy
pnpm run check            # format+lint+app type-check (excludes worker.ts/scripts — see below)
pnpm run check:fix
pnpm run test / test:run / test:coverage  # vitest, 80% threshold
pnpm run type-check       # AUTHORITATIVE: tsc --noEmit && tsc -p tsconfig.worker.json --noEmit
```

Two tsconfigs: `tsconfig.json` (app, excludes worker.ts) + `tsconfig.worker.json` (Workers, add new worker files to `include` or they're un-typechecked). Tests import from `vite-plus/test`, mock `cloudflare:workers`/`vinext` via `tests/mocks`.

## CI (`.github/workflows/ci.yml`)

`validate-lockfile` -> `quality`/`test`/`check` in parallel -> `ci-success` (required). Dependabot ignores `vite-plus` (lockstep pins in `pnpm-workspace.yaml`).

## Conventions

- **API responses:** `ok()`/`fail()` from `lib/api/response.ts` (except `monitoring/health`, `queue/process-section`).
- **Validation:** zod `safeParse` + `mapValidationIssues` -> `fail(400)`. Schemas in `lib/api/schemas.ts`.
- **Auth in routes:** `requireUser(request)` / `getSessionIdentity` -> `UnauthorizedError(401)`; cron/queue -> `verifyCronSecret`.
- **Style:** Oxfmt/Oxlint, 2-space, width 100, single quotes, semicolons, camelCase/PascalCase, imports auto-organized. `pnpm run check:fix`.
- **Tests:** under `tests/`, `*.test.ts(x)` / `*.spec.ts(x)`.
- **Config:** constants in `lib/config.ts`; logging via `log('Scope').info|warn|error` not `console.*`.
- **Email:** all template data through `escapeHtml`; unsubscribe tokens are stateless HMAC (90d, not single-use).

## Critical invariants & gotchas

- **`processSection` order** reset -> **upsert `class_states` before send** — moving send earlier double-sends on retry.
- **Email only the IDs returned by `tryRecordNotificationsBatch`** (claimed set) and **rollback failed sends** via `deleteNotificationRecords`, or users suppressed 24h.
- **Daily `expire_stale_notifications()` + past-term watch delete is load-bearing** — without it re-notifications stop.
- **`processSection` owns `ack`/`retry`** (`SectionCheckOutcome`); callers only translate to transport. HTTP route returns `200` for `ack` on purpose.
- **`class_states` key is `(class_nbr, term)`** — always include term.
- **`proxy.ts` is THE auth gate** (Clerk `jwtKey`, `hasClerkSessionCookies`, `ext_id` claim, `readAuthorizationState` 30s cache). Invalidate via `invalidateAuthorizationState` after consent/admin changes.
- **First-observation guard** (`!oldState`) suppresses false seat emails — keep it.
- **`non_reserved_seats` populated since #198** (`Math.max(0, enrlCap-enrlTot-waitTot)`), fallback `non_reserved_seats ?? seats_available` in `detectChanges`.
- **`lib/asu/terms.ts` needs yearly August update** or new watch creation silently blocks.
- **Never add dynamic API (`headers()`/`cookies()`) to `app/layout.tsx`** — static pages 500. `useSearchParams` needs `<Suspense>`.

## Known doc drift

`README.md`/`CONTEXT.md` drift-pruned 2026-08-22 for Hyperdrive+Clerk+polling. Remaining risk is hard numbers — verify against `wrangler.jsonc`/code.

<!--VITE PLUS START-->
# Using Vite+, the Unified Toolchain for the Web
This project uses Vite+ (`vp`). `vp <name>` runs built-in, `vp run <name>` runs package.json script/task. Docs at `node_modules/vite-plus/docs` or https://viteplus.dev/guide/.
<!--VITE PLUS END-->
