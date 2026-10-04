# AGENTS.md

PickMyClass emails ASU students when a watched class section gains an open seat or gets a named instructor. It is a Next.js 16 App Router app (React 19, strict TS) built by **vinext** (Vite-based) and deployed as one **Cloudflare Worker**, with PlanetScale Postgres through Hyperdrive (request-scoped Drizzle over node-postgres (`pg`)), Clerk auth, Cloudflare Workflows + Queues for scheduled seat checks, and Cloudflare Email for delivery. Features, architecture diagram, and self-hosting are in [README.md](README.md). Use these domain terms in code, tests and issues: `SectionRef` (the `{ class_nbr, term }` pair that identifies a section), Section Check (one `processSection` run for one `SectionRef`) and Cron Cycle (one `SectionCheckWorkflow` run, every 15 minutes; its `cycle` stamp rides on each queue message).

When code and this file disagree, code wins: fix this file in the same change.

## Commands

Toolchain is **Vite+ (`vp`)** wrapping Oxlint, Oxfmt and Vitest. Call it through the `pnpm run` scripts; tests import from `vite-plus/test`.

| Task | Command |
| --- | --- |
| Install | `pnpm install` (pnpm 12.6.0, Node from `.node-version`) |
| Dev server | `pnpm run dev` (vinext; one instance per checkout: a second one exits and prints the running server's URL) |
| Build | `pnpm run build` |
| Real Worker locally | `pnpm run preview` (build + `wrangler dev`); run before any deploy |
| All non-DB tests | `pnpm run test` · with coverage gate (80% lines/branches/functions/statements): `pnpm run test:coverage` |
| One file | `pnpm run test tests/unit/lib/crypto.test.ts` |
| One test | `pnpm run test tests/unit/lib/crypto.test.ts -t "identical"` |
| Test projects/watch | `pnpm run test:unit` · `pnpm run test:integration` · `pnpm run test:watch` |
| Live DB test | `DATABASE_URL=… pnpm run test:db` against a disposable Postgres after `pnpm run db:migrate` (excluded from the normal run) |
| DB migration | `pnpm run db:generate` (or `-- --custom --name=<n>`), then `DATABASE_URL=… pnpm run db:migrate` (direct PlanetScale URL) |
| Format + lint | `pnpm run check` · autofix: `pnpm run fix` |
| Type-check | `pnpm run type-check` (two passes: app `tsconfig.json`, then `tsconfig.worker.json`) |
| Full gate | `pnpm run verify` = check + type-check + knip. Same as the pre-commit hook and CI `quality` job |
| Deploy | `pnpm run deploy` (build, `db:migrate`, `wrangler deploy`, `wrangler triggers deploy`, IndexNow ping; needs `DATABASE_URL`) |

## Repo map (non-obvious parts only)

- `worker.ts`: the Worker entry. Wraps vinext `fetch`, adds `queue()`, re-exports the Workflow classes. Queue messages call `processSection()` directly, with no HTTP hop.
- `proxy.ts`: vinext middleware. This is **the** auth gate and the CSP builder (decision logic in `lib/auth/decide-gate.ts`).
- `lib/workflows/cron-workflows.ts`: `SectionCheckWorkflow` (every 15 min, even/odd stagger, so each section is checked every 30 min) and `MaintenanceWorkflow` (04:05 UTC).
- `lib/queue/`: the seat-check pipeline (`process-section.ts` orchestrates, `change-detector.ts`, `notification-sender.ts`, `section-retirement.ts`).
- `lib/db/index.ts`: the only DB seam (`getDb(hyperdrive)` / `getDbFromEnv()`, request-scoped). `lib/db/queries.ts` holds the Drizzle builders and typed SQL calls to `SECURITY DEFINER` RPCs. `lib/db/schema/` defines the tables.
- `migrations_pg/`: drizzle-kit migrations, the real schema history, tracked in `drizzle.__drizzle_migrations`. `lib/db/schema/` is the source of truth for tables: edit it, then `db:generate`. Functions, triggers and data fixes go in `db:generate -- --custom` files; change a function with `CREATE OR REPLACE` in a new migration, never edit an applied file. `0000_baseline` + `0001_baseline_functions` reproduce prod as of 2026-10-01. `db/migrations/` is frozen pre-drizzle history; never add to it.
- `lib/utils.ts` is shadcn's `cn()` only. Custom helpers go in `lib/utils/`. The split is intentional, so leave both.
- `lib/seo/`: sitemap, `/llms.txt` and `/llms-full.txt` route handlers, lastmod map, IndexNow.
- `tests/unit`, `tests/integration`: all tests live here, not next to source. The `test` block in `vite.config.ts` defines `unit`, `integration`, and opt-in `db` projects. `tests/mocks/` stubs `cloudflare:workers` and the vinext entry through `test.alias`. `tests/unit/lib/db/scripted-postgres.ts` is a scripted node-postgres transport for query tests.
- `tools/oxlint/anti-slop/`: vendored lint plugin (see Gotchas).

## Conventions (enforced by lint or used everywhere)

- **API routes:** wrap handlers in `withAuth(request, async (user) => …)` from `lib/api/withAuth.ts` (401 on `UnauthorizedError`). Validate with `parseOrFail(schema, body)` from `lib/api/validation.ts` (schemas in `lib/api/schemas.ts`). Respond with `ok()` / `fail(msg, status)` from `lib/api/response.ts`. `app/api/class-watches/route.ts` shows the full pattern. `monitoring/health` authenticates with `verifyCronSecret`.
- **Bindings:** `import { env } from 'cloudflare:workers'`. DB access goes through `getDbFromEnv()`, not a module-level client.
- **Logging:** `log('Scope').info|warn|error` from `lib/log.ts`. `no-console` is a lint error outside `lib/log.ts`, `scripts/`, and `tests/`.
- **Type assertions** need a `// SAFETY: …` comment directly above them (`anti-slop/require-safety-comment-for-type-assertion`). Chained `as unknown as X` is banned outright. Other anti-slop rules to know: no object-shaped parameters, no `unknown` params or returns, no `.filter().map()`, no spread-accumulating `reduce`. The full list is in `vite.config.ts` → `lint.rules`.
- **Imports:** `@/…` path alias. `vite-plus/test` instead of `vitest` (the `vite-plus/prefer-vite-plus-imports` rule enforces it).
- **Constants** go in `lib/config.ts`. Style: Oxfmt defaults (2 spaces, width 100, double quotes, semicolons, trailing commas everywhere); `pnpm run fix` applies it.
- **Email:** every template value passes through `escapeHtml` (`lib/utils/escape-html.ts`). Unsubscribe tokens are stateless HMAC, valid 90 days, reusable.
- **Tests** inject dependencies (e.g. `processSection(..., { fetchClass })`, `createScriptedPostgres`) rather than hitting real services. Name files `*.test.ts(x)` under `tests/`.
- **Commits:** Conventional Commits, `type(scope): summary`.

## Gotchas and invariants

**Seat-check pipeline**:
- `processSection` order is: conditional `class_states` upsert (`observedAt` vs `last_checked_at`) → reset notifications → send. A rejected upsert skips both reset and send. Sending earlier double-sends on retry; resetting before the upsert drops a claim when the write fails.
- Email only the watch IDs returned by `tryRecordNotificationsBatch`. Roll back failed sends with the row IDs from that same claim (`deleteNotificationRecordsByIds`), never by re-looking-up the active row, which can delete a newer claim.
- The first-observation guard (`!oldState` → no seat email) prevents false alerts. Keep it.
- There is deliberately no cron lock. Overlapping Workflow instances are made safe by the message `cycle` stamp plus the conditional upsert. Keep both guards and don't add a lock.
- `processSection` owns ack/retry (`SectionCheckOutcome`); callers only translate it for the transport. ASU 429s back off via `retryDelaySeconds()` (60s doubling, honours `Retry-After`, 15-min cap).
- `expire_stale_notifications()` runs in every `SectionCheckWorkflow` run and in `MaintenanceWorkflow`. Re-notifications stop without it.
- `class_states` is keyed on `(class_nbr, term)`. Always carry both (`SectionRef`).
- `lib/asu/terms.ts` holds a hand-maintained ASU term calendar. Extend it every August, or creating new watches silently blocks.
- Seat signal is `non_reserved_seats ?? seats_available`.

**Auth and edge**:
- After consent or admin changes, call `invalidateAuthorizationState`. `proxy.ts` caches `readAuthorizationState` for 30s.
- CSP has two production shapes in `proxy.ts`. Session requests get a per-request nonce. Session-less public pages are edge-cached and get `'unsafe-inline'` with **no** nonce or hash, because either one makes browsers ignore `'unsafe-inline'`. An empty `'nonce-'` once blanked the homepage for anonymous users and Googlebot.
- Never add `headers()` / `cookies()` to `app/layout.tsx`: static pages then 500. `useSearchParams` needs a `<Suspense>` boundary.
- `lib/clerk/config.ts` and `lib/analytics/config.ts` hold public keys as **string literals** on purpose. `process.env.NEXT_PUBLIC_*` does not get inlined into the Worker build.

**Cloudflare config:**
- Workflow `class_name`s in `wrangler.jsonc` must match the classes re-exported from `worker.ts`. Cron schedules live on the Workflow bindings; `triggers.crons` stays `[]`. `CronLockDO` was deleted in migration `v3`, so never reuse that name.
- Workers Free plan limits: Workflow steps get 10ms CPU and 1,024 steps per instance, so keep steps small and I/O-bound. Queues allow roughly 10k ops/day (~3 per message). The DLQ `pickmyclass-dlq` has no consumer; inspect or redrive it from the dashboard.
- Secrets (`CLERK_*`, `ASU_API_*`, `CRON_SECRET`, `UNSUBSCRIBE_SIGNING_SECRET`) are set with `wrangler secret put`, never in `wrangler.jsonc`. Local values go in `.dev.vars` and `.env.local`, both gitignored; `.env.example` lists them.
- `lib/cloudflare-env.d.ts` is **generated** by `pnpm run cf-typegen`, which also rewrites the whole runtime-types section. Commit only the binding hunks unless you mean to bump runtime types. Hand-written additions go in `lib/cloudflare-env.supplemental.d.ts`.
- A new file imported by `worker.ts` must be added to `tsconfig.worker.json` → `include`, or it is never type-checked. `worker.ts` and `scripts/` are also excluded from lint.
- Local `dev` / `preview` reach Postgres at `wrangler.jsonc`'s `localConnectionString` (`localhost:5432`); override with `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`.

**SEO** (tests in `tests/unit/seo-on-page.test.tsx` enforce these):
- A new indexable page needs an entry in `PUBLIC_PAGES` (`lib/seo/public-pages.ts`), the snippet-length table in that test, and, for non-blog pages, a date in `lib/seo/static-page-lastmod.json`. The pre-commit hook re-stamps that date via `lib/seo/lastmod-routes.ts`.
- Rendered `<title>` must be ≤60 chars (templates append ` | PickMyClass`; use `{ absolute }` when the title already names the brand). Descriptions must be ≤160 chars.
- `/llms.txt` and `/llms-full.txt` are route handlers. Never add `public/llms*.txt`, because the static file would shadow the route. `public/<key>.txt` must match `INDEXNOW_KEY`.

**Toolchain:**
- Bump `vite-plus`, `vite`, `vitest` and `@vitest/*` together with `vp migrate`, never one at a time: a solo bump desyncs them and breaks types and coverage. Dependabot ignores them. There is no direct `oxlint` or `@oxlint/plugins` dependency: `oxlint` comes through `vite-plus`, and the vendored anti-slop plugin imports from `vite-plus/lint/plugins`.
- `tools/oxlint/anti-slop/` is vendored and excluded from lint, fmt, tsc and knip on purpose. `vendor/` is un-ignored in `.gitignore`; keep the whole tree committed (CI lint can't load the plugin otherwise).
- `pnpm-lock.yaml` contains two YAML documents (env lockfile, then project lockfile). That is expected. Changing `packageManager` requires regenerating the lockfile, or CI's `--frozen-lockfile` fails. pnpm 12 errors on unknown `pnpm-workspace.yaml` keys.

## Definition of done

1. `pnpm run verify` passes. This is the CI `quality` gate and the pre-commit hook.
2. `pnpm run test:coverage` passes, including the 80% thresholds (CI `test` job).
3. `pnpm run build` passes (CI `check` job).
4. If you touched `worker.ts`, `wrangler.jsonc`, the Workflows or the queue path, run `pnpm run preview` as well.
5. Schema changes ship as committed `migrations_pg/` files (incl. `meta/`) generated from `lib/db/schema/`.
6. Update this file if the change made anything here false.
