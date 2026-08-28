# Repository Guidelines

> **Audience: AI coding agents and contributors.** This file is the onboarding map for working in this repo. Read it before touching code — it explains how the system works, how it's built and tested, the decisions behind it, and the invariants you must not break.

## Keeping this file current (read first)

This file is meant to stay the single authoritative map of the codebase. When you discover something non-obvious — an invariant, a gotcha, a decision and its *why*, a data-flow detail, a hidden coupling — **record it in the relevant section of this file as part of the same change**, then **consolidate**:

- Merge the finding into the closest existing point; prefer editing an existing line over appending a new one. Do not create a duplicate.
- Delete anything your change made false (stale numbers, removed files, fixed bugs).
- Keep entries terse and factual. The goal is one deduplicated map, not an append-only log.
- Do **not** record transient task state, secrets, or anything already obvious from the code.

When a doc claim and the code disagree, the code wins — fix the doc. (README.md and CONTEXT.md predate parts of the current code and contain known drift; see "Known doc drift" below.)

## Maintaining This File

This file is **not** auto-generated. When you make changes that affect anything
documented here — build pipeline, scripts, env vars, routes, key systems,
dependencies, directory layout, or code-style rules — update the relevant
section in the same change so it stays accurate. `AGENTS.md` is a symlink to
this file, so edit `CLAUDE.md`.

---

## Agent skills

### Issue tracker

Issues and PRDs are tracked as **GitHub Issues** on `Divkix/pickmyclass` via the `gh` CLI. External PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

---

## What this is

**PickMyClass** notifies ASU students by email when a seat opens (or an instructor is assigned) in a class section they watch. It's a **Next.js 16 App Router** app (React 19, TypeScript strict) deployed on **Cloudflare Workers via the `vinext` adapter** (Vite-based Next.js — *not* `@cloudflare/next-on-pages` or OpenNext), backed by **PlanetScale Postgres via Cloudflare Hyperdrive (request-scoped Drizzle over postgres-js, `--caching-disabled`) + Clerk** (networkless `jwtKey` verification, `ext_id` claim `{"ext_id":"{{user.external_id || user.id}}"}`) + **polling** (Realtime removed, `docs/adr/0014-realtime-to-polling.md`), with **Cloudflare Email Service** for all transactional email and **Cloudflare Queues + a Durable Object** for the seat-checking pipeline. Tooling is **Vite+ (`vp`)** and the package manager is **`pnpm@11.10.0`**.

The data plane is PlanetScale Postgres through Hyperdrive (request-scoped Drizzle over postgres-js in `lib/db/index.ts`, `--caching-disabled`; `docs/adr/0013-data-access-hyperdrive.md`); the auth plane is Clerk (see `lib/auth/clerk-session.ts` + `lib/db/users.ts` mirror + `lib/clerk/config.ts` literal `CLERK_PUBLISHABLE_KEY`; Svix webhook at `/api/webhooks/clerk`; `docs/adr/0012-auth-plane-clerk.md`). Secrets are `CLERK_*` (hand-typed in `lib/cloudflare-env.supplemental.d.ts`). Sign-in/sign-up are Clerk **hosted components** at `/sign-in` and `/sign-up` (issue #354 removed the last Supabase shims).

The two systems worth understanding before anything else are the **seat-check notification pipeline** and the **auth/account lifecycle** (both below).

---

## Architecture at a glance

```
Browser ──> vinext app (Cloudflare Worker: worker.ts) ──> PlanetScale Postgres via Hyperdrive (Drizzle/postgres-js, polling)
                          │         │                               ▲
   Cloudflare Cron ───────┤         │ Clerk FAPI (clerk.*)          │ polling GET /api/class-watches/states
   0,30 * * * * (checks)  │         │ (jwtKey verify, webhook)      │ (30–60s, sectionRefKey, docs/adr/0014)
   0 4 * * *   (daily)    ▼         ▼
              worker.ts scheduled()  ── internal fetch ──> /api/cron
                                                              │ getSectionsToCheck (RPC, even/odd stagger)
                                                              ▼
                                              Cloudflare Queue (pickmyclass-queue)
                                                              ▼
              worker.ts queue() ── DIRECT call (no HTTP) ──> processSection()
                                                              │ fetchClassFromASU → detectChanges → upsert → notify
                                                              ▼
                              ASU Catalog API (direct HTTP)   Cloudflare Email Service (EMAIL binding)
                                                              ▼
                                              failures after 3 retries → pickmyclass-dlq → admin alert
```

**Correction vs README/CONTEXT.md:** the live queue consumer is `worker.ts queue()`, which calls `processSection()` **directly** (not internal HTTP). `app/api/queue/process-section/route.ts` is a maintained **mirror** for HTTP-dispatched processing / tests; both read `outcome.disposition` from `processSection()` (`lib/queue/process-section.ts` returns `SectionCheckOutcome`; the `classifyDisposition` table was folded inside it). Rationale + decision table: `docs/adr/0006-queue-ack-retry-contract.md`.

---

## Pipeline 1 — Seat-check notifications (the core)

Files: `worker.ts`, `app/api/cron/route.ts`, `lib/queue/*`, `lib/asu/api.ts`, `lib/db/queries.ts`, `lib/email/send.ts`, the notification RPCs in `db/migrations/*`.

1. **Cron trigger** (`wrangler.jsonc` crons `0,30 * * * *` and `0 4 * * *`) → `worker.ts scheduled()`. It routes `0 4 * * *` → `/api/cron/maintenance`, everything else → `/api/cron`, via an internal `handler.fetch()` with `Authorization: Bearer ${CRON_SECRET}` and **`X-Cron-Scheduled-Time`** (the scheduled ms). It logs `CRON_PARTIAL_FAILURE` on `!ok || 207` but never throws (Cloudflare cron has no auto-retry).
2. **`/api/cron`**: `verifyCronSecret` (timing-safe) → `createCronLockClient` acquires the single global **`CronLockDO`** lease (auto-expires after **25 min** < the 30-min cadence) — not acquired ⇒ `409`, no enqueue; missing binding deliberately fails open. The client in `lib/worker/cron-lock.ts` hides DO identity/URLs/wire parsing and the lease owns release. Computes **stagger group** from `X-Cron-Scheduled-Time` (`:00` = even, `:30` = odd by last digit of `class_nbr`) so a *delayed* cron still maps to the right window. `getSectionsToCheck(stagger)` (RPC) returns distinct `(class_nbr, term)` with active watchers. Enqueues `ClassCheckMessage` in **batches of 100** (CF `sendBatch` hard limit) with exactly **one** retry pass; partial failure ⇒ `207`. Lease released in `finally` (errors swallowed; relies on the 25-min auto-expiry). Sections whose term has ended are dropped here via the **`getPastTermCodes()` → `Set` → `.filter(s => !pastTerms.has(s.term))`** enqueue filter so they never hit ASU; the daily 4 AM job additionally **hard-deletes** past-term `class_watches` (cascades to `notifications_sent`) using the same set. Both rely on `ASU_TERM_CALENDAR` retaining retired terms — never prune past terms from it. ASU 404s are still acked (non-retryable); they are not used as a deletion signal because a single 404 can be transient. Boundary: `docs/adr/0011-cron-lock-lifecycle-boundary.md`.
3. **`worker.ts queue()`** consumer (config: `max_batch_size 5`, `max_concurrency 20`, `max_retries 3`, `retry_delay 60s`, DLQ `pickmyclass-dlq`). For `pickmyclass-dlq` → `handleDLQMessage` then **always ack**. Otherwise `processSection()` per message returns `SectionCheckOutcome { disposition: 'ack'|'retry', result, httpStatus }` — the disposition table lives **inside** `processSection` (`lib/queue/process-section.ts`) and callers only translate `outcome.disposition` to their transport (queue `ack()`/`retry()` vs HTTP `200`/`429`/`502`). Decision table + why `ack→200`: `docs/adr/0006-queue-ack-retry-contract.md`.
4. **`processSection()`** (`lib/queue/process-section.ts`) — order is **load-bearing**:
   1. read `class_states` baseline by `(class_nbr, term)`; `PGRST116` (no row) = first observation, **not** an error.
   2. `fetchClassFromASU` (may throw the typed errors above).
   3. `detectChanges(old, new)` (pure).
   4. **First-observation guard:** if `!oldState`, force `seatBecameAvailable=false` and `instructorAssigned=false` — only seed the baseline, never email on first sight.
   5. if `seatsFilled` ⇒ `resetNotificationsForSection(..., 'seat_available')` (hard-delete those dedup rows so users can be re-notified).
   6. **UPSERT `class_states` (onConflict `class_nbr,term`) BEFORE sending.** A retried message then reads the new baseline and won't re-fire. **Never move the send before the upsert** — it double-sends on retry.
   7. if `seatBecameAvailable || instructorAssigned` ⇒ `sendSectionNotifications()`.
5. **`detectChanges`** (pure, keep it pure): primary seat signal is **`non_reserved_seats ?? seats_available`** (see note below). `seatBecameAvailable = old===0 && new>0`; `seatsFilled = old>0 && new===0`; `instructorAssigned = oldInstructor==='Staff' && new!=='Staff' && defined`. A direct prof→prof change is *not* detected (must pass through `Staff`).
6. **`sendSectionNotifications()`**: `get_watchers_for_sections` (RPC, **SectionRef-scoped** — `section_numbers` + `p_term`, so a transition in one term can't select watchers for the same class number in another term; fixed in `20260712000001`) → **atomic claim** `tryRecordNotificationsBatch(watchIds, type)` which returns **only the newly-claimed ids** (that set *is* the authorization to email; emailing the full input array double-sends) → `sendBatchEmailsOptimized` → **rollback** failed sends via `deleteNotificationRecords` (else those users are suppressed for the 24h window). Delivery success is not treated as open/engagement evidence; the app deliberately has no tracking pixels. `sendSectionNotifications` takes a `ref: SectionRef` (not a bare `classNbr`) so the term flows unbroken from `processSection` into the watcher lookup.
7. **Email** (`lib/email/send.ts`): no CF bulk API — `env.EMAIL.send()` sequentially with `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click` headers; **hard-stops** the whole batch on `E_RATE_LIMIT_EXCEEDED` / `E_DAILY_LIMIT_EXCEEDED` / `E_SENDER_NOT_VERIFIED`; throttles `EMAIL_BATCH_DELAY_MS` (75ms) between sends when batch > `EMAIL_BATCH_SIZE` (10). CTA links (built in `lib/email/templates/index.ts`, *not* `send.ts`) point at the internal **`/go/asu`** redirect (`app/go/[uni]/route.ts` → 302 to `catalog.apps.asu.edu`, digits-only sanitized), not asu.edu directly, so link domain == sending domain for deliverability.
8. **DLQ** (`lib/queue/dlq-consumer.ts`, config `max_batch_size 1`, `max_retries 0`): logs + emails an admin alert to `ALERTS_FROM_EMAIL`. **Must never throw** (the worker acks unconditionally). The failed section is retried next cron cycle anyway.

**Dedup lifecycle (critical):** `notifications_sent` dedups via a **partial unique index `unique_notification_active WHERE is_active=TRUE`** + `try_record_notifications_batch` + the **daily 4 AM `expire_stale_notifications()` RPC** (the only thing that frees expired dedup slots; also hard-deletes past-term watches via `getPastTermCodes → delete class_watches`). Load-bearing: if the sweep stops, users never get re-notified after the 24h window. Why (issue #157, no volatile `NOW()` in a partial-index predicate): `docs/adr/0004-notification-dedup-lifecycle.md`.

**`non_reserved_seats` is populated, not dormant** — since issue #198 the ASU client computes it (`Math.max(0, enrlCap - enrlTot - waitTot)` in `lib/asu/api.ts`) and `upsertClassState` persists it (`lib/db/queries.ts`); migration `20260212000125` only NULLed pre-existing rows during the transition. When it's NULL (no waitlist data), `detectChanges` still falls back to `seats_available` via `non_reserved_seats ?? seats_available` — keep the column and that fallback. (`docs/adr/0005-non-reserved-seats-dormant-column.md` and memory `asu-no-waitlist-data` predate #198 and are stale on this point.)

---

## Pipeline 2 — Auth & account lifecycle (Clerk)

Files: `app/sign-in/[[...sign-in]]/page.tsx` + `app/sign-up/[[...sign-up]]/page.tsx` (Clerk hosted `<SignIn>`/`<SignUp>` components, `routing="path"`), `app/api/auth/*` (`signout`, `consent`), `app/api/webhooks/clerk/route.ts` (Svix), `app/auth/post-oauth/route.ts`, `lib/auth/clerk-session.ts` + `lib/auth/clerk-cookies.ts` + `lib/auth/authorization-state.ts` + `lib/auth/require-user.ts`, `lib/clerk/config.ts` + `components/ClerkClientProvider.tsx`, `lib/db/users.ts` mirror, `lib/contexts/AuthContext.tsx` compat, `proxy.ts` + `lib/auth/decide-gate.ts`. **No `register`/`login`/`check-lockout`/`email-verified`/`logout`/`reset-password` server routes** (issue #354 deleted them; Clerk Attack Protection replaces app-level lockout).

- **Sign-up / sign-in:** Clerk-hosted `<SignUp>`/`<SignIn>` at `/sign-up`/`/sign-in` (brand via `appearance.variables.colorPrimary #7a0019`). Email verification happens inside the hosted flow; no server register/login endpoints, no sign-in tickets. Consent is captured post-auth at `/consent` (gate below) — `public_metadata` is no longer the source.
- **Sessions:** `lib/auth/clerk-session.ts` owns `getClerkClient` (per-isolate cache + `jwtKey` PEM networkless `authenticateRequest`/`verifyToken` under `workerd`) + `getSessionIdentity(request)` / `getSessionIdentityFromHeaders(headers)` reading the `ext_id` claim (`{{user.external_id || user.id}}`, fallback `sub`) + `revokeSession`/`revokeAllUserSessions`. Fast-path `hasClerkSessionCookies(header)` (`lib/auth/clerk-cookies.ts`, prefixes `__session/__client_uat/__refresh/__clerk_db_jwt/__clerk_handshake`, clear list `CLERK_COOKIES_TO_CLEAR`). `requireUser()` throws `UnauthorizedError(401)` via Clerk headers. Client `AuthContext` is a compat layer: `useUser`/`useClerkAuth` → `CompatUser`/`CompatSession`.
- **Unverified users:** `decideGate` rule ② redirects them to `/sign-in` (allow-listed there alongside `/auth/post-oauth`) so they resume verification inside the hosted flow; the mirror's `email_confirmed_at` flips via the webhook within the 30s cache TTL.
- **OAuth:** Google uses Clerk's hosted connection and lands on `/auth/post-oauth` (the SignUp `fallbackRedirectUrl`). The route is a transport adapter: it calls `repairUserMirror(userId, clerkUserId)` **once**, then routes off its result — `null` (no primary email) redirects to `/consent?error=save_failed`; unconfirmed consent routes by `result.hasConsent` (no route-owned profile SQL); confirmed consent still runs the `accept_terms_and_verify_age` RPC + `invalidateAuthorizationState`. Re-links by verified email.
- **Webhooks:** `POST /api/webhooks/clerk` Svix `verifyWebhook` (`CLERK_WEBHOOK_SIGNING_SECRET` `whsec_...`) is a transport adapter over `lib/db/users.ts`: `user.created/updated` delegate to `syncUserMirrorFromClerkUser(payload)`, which owns the **sole primary-email policy** (primary-id address match, else first listed) plus lowercasing, verification derivation, stable id (`external_id ?? Clerk id`), metadata booleans, timestamps, and the idempotent mirror+profile upsert; `false` = no email. `user.deleted` → `softDeleteUserById`. Keep `prevent_user_profile_escalation` (non-service writes no-op).
- **Consent / admin / delete:** `/api/auth/consent` re-validates both confirmations, calls `repairUserMirror` first (repairs the webhook race; `null` ⇒ `409`), records missing timestamps via RPC, `invalidateAuthorizationState`; `proxy.ts` blocks `has_consent=false` from protected pages. `verifyAdmin()` (RSC `redirect()`) uses fresh `readAuthorizationState`. `DELETE /api/user/delete` performs **its own soft delete** (`UPDATE user_profiles SET is_disabled=true, disabled_at, notifications_enabled=false, unsubscribed_at` — *not* `softDeleteUserById`) before `invalidateAuthorizationState` + `revokeAllUserSessions`; `GET /api/user/export` returns JSON `Cache-Control: no-store`. See `docs/adr/0001-authorization-state-boundary.md`.

---

## The edge auth gate (`proxy.ts`)

| File | Role | Matcher |
|------|------|---------|
| **`proxy.ts`** | **THE auth gate** (vinext convention — `proxy.ts` is the only middleware file). Thin I/O shell: **per-request CSP nonce** + all security headers + `hasClerkSessionCookies` fast-path + `getSessionIdentity(request)` (`@clerk/backend` `authenticateRequest` with `jwtKey` PEM, `ext_id` claim) + **cached** `readAuthorizationState` (30s per-isolate cache owned by `lib/auth/authorization-state.ts`; `docs/adr/0012-auth-plane-clerk.md`). Pure routing lives in `lib/auth/decide-gate.ts` (`decideGate` → `GateDecision`); `proxy.ts` only adds headers once and translates `GateDecision` to `NextResponse`. Also clears Clerk cookies on `signout-and-redirect` / `disabled` via `CLERK_COOKIES_TO_CLEAR`. | catch-all |

- Caching has **three layers**: `lib/worker/edge-html-cache.ts` owns the **edge HTML cache** (Cache API `caches.default`; `worker.ts fetch()` only adapts vinext + `ctx.waitUntil`; anonymous GETs to `/`, `/faq`, `/about`, `/blog`, `/blog/*`, `/legal`, `/legal/*` — a HIT skips `proxy.ts` + the RSC render entirely; the big CPU saver, and the **only** thing setting `Cache-Control` on HTML), **`public/_headers`** (static assets — fonts/images `immutable` 1yr; `llms.txt`/`llms-full.txt`/og-image with SWR), and the Cloudflare edge. The module's three-operation seam (`isEligible`, `get`, `put`) hides pathname+version-id keying, anonymous/200/no-`Set-Cookie` rules, **RSC exclusion + HTML-only storage** so a flight payload can't poison the entry, frozen-nonce behavior, and `EDGE_HTML_CACHE_TTL_S` 1h. Rationale: `docs/adr/0009-edge-html-cache-rsc-exclusion.md` (supersedes `0003`). Add worker-side files to `tsconfig.worker.json` explicitly.
- Routing/redirect decisions live in `lib/auth/decide-gate.ts` (`decideGate` pure, testable without Clerk/NextResponse); `proxy.ts` is the sole edge gate and only handles nonce/CSP/cookie I/O + `addSecurityHeaders` once. Constants since #354: `PUBLIC_ROUTES = ['/sign-in','/sign-up','/legal','/auth/post-oauth','/go','/faq','/blog']`, `AUTH_PAGES = ['/sign-in','/sign-up']`, protected prefixes `/dashboard`+`/admin`+`/settings`+`/consent`; unverified users are allowed onto `/sign-in` itself (rule ②) to resume verification in the hosted flow.
- Security/CSP/nonce still live in `proxy.ts` (single header application via one exit, not 9). **Clerk publishable key is a committed literal** in `lib/clerk/config.ts` (`pk_live_...` → `clerk.pickmyclass.app`); CSP allows `*.clerk.accounts.dev` + `https://clerk.pickmyclass.app` + `https://challenges.cloudflare.com` + `https://*.protect.clerk.com:*` + `https://img.clerk.com` (`CLERK_CSP`).
- **PostHog project token** is a public client constant in `lib/analytics/config.ts` (same rationale as the Clerk publishable key). Client init (`instrumentation-client.ts`) and the typed browser boundary (`lib/analytics/client.ts`) import from there — do **not** reintroduce `process.env.NEXT_PUBLIC_POSTHOG_*`: those are build-time-only, and wrangler `vars` are runtime-only, so a deploy without the env at build time inlined `undefined` and dropped all client events. Both clients send through the managed proxy `https://s.pickmyclass.app` (allowed by CSP `connect-src`; never add a same-origin external rewrite because vinext forwards request credentials through external rewrites, and never point back at `https://us.i.posthog.com`). The browser imports `posthog-js/dist/module.no-external` plus the bundled `exception-autocapture` extension so exception capture stays active, unused extensions stay out of the main chunk, and CSP never needs to allow runtime code from PostHog asset hosts.
- The production CSP whitelists next-themes' inline no-flash script via a specific **sha256 hash** in `proxy.ts` — changing that script breaks CSP/theme-flash until the hash is regenerated. RSC inline scripts (JSON-LD in `app/layout.tsx`) read the nonce from `next/headers` (`x-nonce`); never add `'unsafe-inline'`.
- After mutating an authorization field (`is_admin`/`is_disabled`), call `invalidateAuthorizationState(userId)` (from `lib/auth/authorization-state.ts`) or `proxy.ts` serves a 30s-stale decision.

---

## Data layer — PlanetScale Postgres via Hyperdrive (Drizzle + postgres-js)

**Single seam** `lib/db/index.ts`: `getDb(hyperdrive)` / server-only `getDbFromEnv()` build a **request-scoped** Drizzle instance over postgres-js (`prepare:false`, `fetch_types:false`, max 5 connections) from the `HYPERDRIVE` binding — no global Pool and no registration step; never cache the handle across invocations. All DB access goes through this seam via the typed-query helpers in `lib/db/queries.ts` / `lib/db/admin-queries.ts` / `lib/db/users.ts` — **no PostgREST, no `@supabase/supabase-js`, no `pg`**. Details `docs/adr/0013-data-access-hyperdrive.md`.

- **RPC-first.** Heavy reads/writes (watcher lookups, section enumeration, dedup, admin pagination, counts, activity) are **`SECURITY DEFINER` Postgres functions** called via `SELECT …` with parameters, so filtering/joins/aggregation stay in SQL. Dead single-record/count/engagement RPCs removed `20260712000005`. Admin pagination RPCs (`get_users_page`/`get_classes_page`) return the page **plus** `total_count` on every row (read `data[0].total_count`) and whitelist sort columns via static `CASE`; `get_classes_page` groups by full SectionRef (`class_nbr`, `term`), never `class_nbr` alone.
- **Tables (5+1):** `class_watches`, `class_states`, `notifications_sent`, `user_profiles`, `failed_login_attempts` + `users` mirror (`clerk_user_id TEXT UNIQUE`, `external_id` import). **`class_states` is unique on `(class_nbr, term)`** — not `class_nbr` alone (fixed `20260520000000`). Every upsert/lookup must include `term`.
- **`user_profiles`** is 1:1 with the Clerk user mirror (kept in sync by `lib/db/users.ts` — `syncUserMirrorFromClerkUser` via webhook, `repairUserMirror` race repair before consent — not an `auth.users` trigger) and holds `is_admin`, `is_disabled`, consent timestamps, `notifications_enabled`/`unsubscribed_at`, `email_bounced`/`spam_complained`, `onboarding_*` columns. `prevent_user_profile_escalation` trigger still silently forces privileged columns back to `OLD` for non-service roles.
- **Onboarding state** (`onboarding_completed_at`/`onboarding_skipped_at`, both nullable): new users get NULL for both and see a blocking **3-step `OnboardingModal`** on the dashboard — Step 1 "Find a class ID" (ASU catalog link), Step 2 "Add the watch" (a `SimplifiedWatchForm` with class number + term only), Step 3 "You're all set" confirmation (closes on next click → `onCompleted` adds the watch locally and drops the modal + card). `SimplifiedWatchForm`, the dashboard's `AddClassWatch`, and undo all create through **`lib/class-watches/class-watch-creation.ts`**, which owns selectable terms, `createClassWatchSchema` validation, POST encoding, error extraction, and the created-watch result; caller navigation, analytics, onboarding state, and toasts stay outside. The server `/api/class-watches` route and atomic `create_class_watch_with_limit` RPC remain authoritative. Escape/backdrop/Skip (steps 1–2) all POST `/api/user/onboarding` → `skip_onboarding()` RPC (SECURITY DEFINER, authenticated; no-ops if already completed/skipped); a `completedRef` guards the step-3 close so `onCompleted` can't double-fire, and `onSubmittingChange` keeps the modal's `creating` guard active for the entire watch POST so Skip/Back stay disabled. PostHog `onboarding_started`/`onboarding_completed` fire client-side in the modal; `onboarding_skipped` fires server-side in the skip route. After skipping, a `FinishSetupCard` shows until the first watch is created (POST `/api/class-watches` sets `onboarding_completed_at` via the service client when not already completed — this includes skipped users, per ADR 0010; the guard filters only `onboarding_completed_at IS NULL`, not `skipped_at`). Existing users were backfilled to `onboarding_completed_at = NOW()` at migration `20260711000000`, so they never see the modal/card. Onboarding state is exposed both via `/api/user/onboarding` GET and folded into the `/api/class-watches` GET response (`onboarding` field) so the dashboard doesn't need an extra mount-time fetch. The lifecycle (status derivation, `pending→skipped`/`pending→completed`/`skipped→completed` transitions, the first-watch completion guard) is owned by **`lib/onboarding.ts`** (`onboardingStatus`, `toOnboardingState`, `completeOnFirstWatch`, `applyFirstWatchGuard`); routes/components are transport/view adapters — don't re-inline transition rules in the routes or dashboard (issue #307).
- **Onboarding popular-class example** (issue #300): on open, the modal GETs `/api/onboarding/popular-class`, which calls the `get_most_watched_class(p_term)` RPC (SECURITY DEFINER, service_role-only, migration `20260712000000`) for the current selectable term (`getSelectableTerms()[0]`) and validates the top SectionRef via `fetchClassFromASU`. The RPC counts only eligible watchers through `private.is_watcher_eligible` and `ORDER BY COUNT(*) DESC, class_nbr ASC LIMIT 1`. On success the modal shows a "Track this class" card (subject/catalog/title/class #) whose click sets `prefillClassNbr` and advances to step 2 (the `SimplifiedWatchForm` mounts with `defaultClassNbr`). Any failure (no selectable term, no watches, ASU 404/error, RPC error) **fails open to `popularClass: null`** and the modal shows the text-only guide instead — the fetch never blocks onboarding.
- **Watcher eligibility** is owned by the private pure SQL function `private.is_watcher_eligible`: notifications enabled, not bounced, not spam-complained, and account enabled. `get_sections_to_check`, `get_watchers_for_sections`, `get_class_watchers`, and `get_most_watched_class` must call that function rather than copy its predicates (the pgTAP specs that covered it were deleted in #354 — PlanetScale can't run them). `get_class_watchers` and `get_watchers_for_sections` are keyed on the full SectionRef — `(class_nbr, term)`, never `class_nbr` alone — so admin Watchers tables, DLQ alert counts, and notification recipients don't over-list across terms (fixed `20260701040540` / `20260712000001`).

**Migrations** (`db/migrations/`, plain SQL — Supabase CLI removed in #354):
- Filenames are timestamp-prefixed (`YYYYMMDDHHMMSS_*.sql`); the directory is a **history-only archive** now (newest file is the PlanetScale schema snapshot). Schema changes are new hand-run SQL files there; there is no CLI push/reset workflow and no generated types to refresh.
- Filenames are ordered; **last definition wins**. To change an applied function, add a **new** migration that `CREATE OR REPLACE` / `DROP+CREATE`s it — **never edit an applied migration**.
- Every sensitive `SECURITY DEFINER` function must `SET search_path = public` and be locked down: `REVOKE EXECUTE FROM PUBLIC/authenticated/anon` then `GRANT EXECUTE TO service_role`. `GRANT` alone is additive and leaves it callable by PUBLIC (the bug fixed in `20260501000000`).
- `notification_type` is always exactly `'seat_available'` or `'instructor_assigned'` (CHECK + re-validated in every RPC). Adding a type means touching the column, the RPCs, and `lib/queue/*` / `lib/db/queries.ts`.

---

## Subsystem quick-reference

- **ASU client** (`lib/asu/api.ts`): `fetchClassFromASU(ref, env)` is the only network seam. Parses ASU's Elasticsearch envelope (all-UPPERCASE fields), and **must `hits.find(_source.CLASSNBR === classNbr)`** — ASU returns fuzzy matches, so `hits[0]` can be the wrong section. 10s timeout, 2-min per-isolate `TtlCache` (not cross-isolate). Throws the typed error hierarchy `ApiError` ⊃ `AuthError`(401/403) / `RateLimitError`(429) / `NotFoundError` — callers branch on `instanceof` for retry decisions, so never swallow these.
- **ASU terms** (`lib/asu/terms.ts`): a **hand-maintained** academic-calendar table (dates from registrar.asu.edu, all math in `America/Phoenix`, no DST). **Must be extended each August** or `getSelectableTerms()` returns `[]` and new watch creation is silently blocked. Existing watches keep processing because `classCheckMessageSchema` is format-only (no selectable-term refinement, unlike `createClassWatchSchema`/`fetchClassDetailsSchema`).
- **Email** (`lib/email/`): all user data in templates **must** pass through `escapeHtml` (no auto-escaping engine). Unsubscribe tokens are stateless HMAC (`UNSUBSCRIBE_SIGNING_SECRET`, 90-day expiry, **not single-use**) — rotating the secret invalidates all existing links. Notification emails require `UNSUBSCRIBE_SIGNING_SECRET` (the send loop mints a token per email; unset ⇒ hard fail).
- **Browser watch creation** (`lib/class-watches/class-watch-creation.ts`): the only client-side creation seam. It returns options plus `create(input)`, validates with `createClassWatchSchema`, POSTs only the SectionRef, normalizes network/API/malformed-response failures, and returns a validated created-watch shape. Keep navigation, analytics, onboarding state, and toast copy in callers; don't add another `/api/class-watches` POST.
- **Auth helpers** (`lib/auth/`): `requireUser` (Clerk `getSessionIdentity`, throws 401) + `verifyAdmin` (RSC `redirect()`). `verifyCronSecret` uses `timingSafeCompare` (SHA-256 then `timingSafeEqual`). Lockout protection is **Clerk Attack Protection** (app-level `login-attempt-policy` deleted in #354). Clerk seams: `lib/auth/clerk-session.ts` (per-isolate `getClerkClient` + `jwtKey`) + `lib/auth/clerk-cookies.ts` (prefix detection + `CLERK_COOKIES_TO_CLEAR`) + `lib/clerk/config.ts` (literal `CLERK_PUBLISHABLE_KEY` + CSP). See `docs/adr/0012-auth-plane-clerk.md`.
- **Blog** (`app/blog/`, `components/blog/`, `lib/blog/posts.ts`): fully **static, hand-authored RSC per post** (no CMS/MDX/`[slug]`), 9 posts, AEO/GEO-first (ShortAnswer + KeyTakeaways + FAQ + Article/Breadcrumb/FAQPage/HowTo JSON-LD via shared `JsonLd`). Adding a post means editing **three+ places**: `app/blog/<slug>/page.tsx`, the `lib/blog/posts.ts` registry (feeds index + `feed.xml` + `sitemap.ts`), and **`public/llms-full.txt`** (asserted by `tests/unit/seo-production-assets.test.ts`). `BlogFAQ` renders the visual FAQ and FAQPage schema from the same `faqItems`.
- **SEO/AEO**: `app/robots.ts` explicitly **allow-lists AI bots** (GPTBot, ClaudeBot, PerplexityBot, …) — intentional. `public/llms.txt`, `llms-full.txt`, `pricing.md` are agent-readable assets. All marketing/content pages use `export const dynamic = 'error'` (static-or-build-fails). **Never add a dynamic API (`headers()`/`cookies()`) to `app/layout.tsx`** — it forces every static page dynamic and they 500. Root layout OG/Twitter is site-wide only (type/locale/siteName/images/card) — page title, url, and description live on the route (`app/page.tsx`, `/faq`, `/about`, `/blog`) so children do not inherit the homepage `og:url` / `twitter:title`. Sitemap lastmod is per-URL (newest of `dateModified`/`publishedAt` for posts; dated static paths in `app/sitemap.ts`), not a shared stamp. `/blog` emits BreadcrumbList JSON-LD (with `item` URLs) alongside the visual crumbs. Skip-to-content is first in `app/layout.tsx` and targets `#main` (every page provides a `<main id="main">` landmark). Homepage body copy links the seat-tracker, class-search, waitlist, and full-class guides — not registrar how-to-register queries. Hero H1 uses `.animation-hidden` with a CSS appear animation plus `prefers-reduced-motion` / `scripting: none` `opacity: 1` fallbacks so ATF copy stays visible if JS is slow.
- **UI** (`components/`): shadcn/ui (new-york, lucide) on Radix + cva + **Tailwind 4 (CSS-first — theme in `app/globals.css`, no `tailwind.config`)**. Brand = ASU maroon/gold oklch. `Button` renders `motion.button` (44px `h-11`) but plain Slot when `asChild`. Admin tables are **URL-searchParams-driven**. Live states via `useRealtimeClassStates` — **polling** `GET /api/class-watches/states` (not Supabase Realtime; `docs/adr/0014-realtime-to-polling.md`) — its `classNumbers` input **must be `useMemo`'d** or it infinite-loops, and its map is keyed by **`sectionRefKey` (`term:class_nbr`), not `class_nbr` alone** (same for `getUserWatches`). Skip-to-content (`components/SkipToContent.tsx`) is the first focusable node in `app/layout.tsx` and must keep targeting `#main`.
- **Config/logging**: tunable constants live in `lib/config.ts` (from-addresses, `ASU_CACHE_TTL_MS`, `EMAIL_BATCH_SIZE/DELAY_MS`, `UNSUBSCRIBE_TOKEN_EXPIRY_DAYS`, cache TTLs) — don't hardcode at call sites. Use `log('Scope').info|warn|error` instead of `console.*` (the `no-console` lint rule only whitelists `lib/log.ts` and tests).
- **Analytics** (`lib/analytics/config.ts` + `events.ts` + `client.ts` + `server.ts`, `instrumentation-client.ts`, root `instrumentation.ts`): product analytics + exception capture. Public token is a committed string constant (see edge-auth section); every event name/payload is typed against `AnalyticsEventMap` in `lib/analytics/events.ts`. Browser callers use `trackAnalyticsEvent` / `identifyAnalyticsUser` / `resetAnalyticsIdentity` / `captureAnalyticsError`; identity = the stable app user id (`externalId ?? Clerk id`, same as `ext_id`). Server routes emit via `captureServerEvent(distinctId, event, properties)` — a **fresh** client per send (`flushAt 1`, `flushInterval 0`, no retries, 1s timeout) whose flush + `shutdown(1000)` promise is registered with `waitUntil` from `cloudflare:workers`, so analytics outages fail open and never block the response; do not await it. Unhandled request errors flow from root `instrumentation.ts` → `captureServerException` (forwards only path/method/routePath/routeType/routerKind — never headers). Source-map upload is build-only and opt-in via the deploy script's `POSTHOG_UPLOAD_SOURCEMAPS=true`. Upload runs only when `POSTHOG_API_KEY` and `POSTHOG_PROJECT_ID` are present (local `.env` or Workers Builds secrets); missing credentials skip the plugin so Cloudflare Workers Builds can still deploy. Ordinary builds never upload.

---

## Project structure

```
app/          # Routes, pages, API endpoints (App Router, no route groups)
lib/          # Core business logic and utilities
components/   # React components (ui/, admin/, landing/, blog/, + shared root)
tests/        # unit/, integration/, mocks/
worker.ts     # Cloudflare Worker (fetch, scheduled/cron, queue, CronLockDO)
proxy.ts      # vinext middleware — REAL auth gate + security headers + CSP nonce
db/           # db/migrations/ — timestamped SQL schema history (plain PG, no CLI)
scripts/      # build/utility scripts (e.g. OG image generation)
public/       # static + AEO assets (llms.txt, llms-full.txt, pricing.md, og-image.png)
```

**Key `lib/` sub-modules:** `asu/` (client + terms), `api/` (zod schemas + `ok()/fail()`), `auth/` (authorization-state + `decide-gate` + `clerk-session` + `clerk-cookies` + `require-user`), `clerk/` (publishable key + CSP), `class-watches/` (browser creation seam), `db/` (Drizzle schema + request-scoped `index` accessor + `queries` + `admin-queries` + `users` mirror + `pg-errors`), `queue/` (process-section + `SectionCheckOutcome`, change-detector, notification-sender, dlq-consumer), `worker/` (edge runtime), `email/` (send + templates + unsubscribe-token), `cache/`, `hooks/` (polling), `contexts/` (Auth compat), `types/`, `blog/`, `config.ts`, `log.ts`, `animations.ts`.

**Naming collisions to remember:** `lib/utils.ts` holds **only** the shadcn `cn()`; `lib/utils/` is custom utilities (crypto, escape-html, ratemyprofessor, seat-badge, time-format). By design — don't "deduplicate" them.

---

## Cloudflare Workers runtime

- **`worker.ts`** wraps vinext's `app-router-entry` and adds `scheduled` (cron), `queue` (consumer), and the `CronLockDO` Durable Object adapter. Lock lifecycle/status plus the DO client live in `lib/worker/cron-lock.ts`; the class only adapts Durable Object storage + HTTP dispatch. (The worker also strips bodies off GET/HEAD requests — bots send them and the Web API forbids it.) `CronLockDO` must remain a named export, a default-export property, and force-exported via `__durableObjectExports` to defeat tree-shaking; keep those references and the `wrangler.jsonc` migration aligned.
- **Bindings** (`wrangler.jsonc` + `lib/types/env.ts`): `HYPERDRIVE` (`749d7808…` PlanetScale Postgres, `--caching-disabled`), `PICKMYCLASS_QUEUE` (→ `pickmyclass-queue`), DLQ `pickmyclass-dlq`, `PICKMYCLASS_CRON_LOCK_DO` (DO), `EMAIL` (Cloudflare Email Service, remote), `ASSETS`, `CF_VERSION_METADATA` (`version_metadata` — deploy version id for edge HTML cache key). Vars: `MAX_WATCHES_PER_USER` (10), `NOTIFICATION_FROM_EMAIL`, `NEXT_PUBLIC_SITE_URL`.
- **Secrets** (set via `wrangler secret put`, **never** in `wrangler.jsonc`): `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` alias), `CLERK_JWT_KEY` (PEM, networkless), `CLERK_WEBHOOK_SIGNING_SECRET` (`whsec_…`), `ASU_API_BASE_URL`, `ASU_API_TOKEN`, `CRON_SECRET`, `UNSUBSCRIBE_SIGNING_SECRET`. No `SUPABASE_*` secrets remain. Never appear in generated CF types — `env as unknown as Env` casts for them are correct.
- **Accessing bindings inside routes:** `import { env } from 'cloudflare:workers'` then cast `env as unknown as Env` (or a narrow inline `Pick`). Bindings are **not** passed as route params.
- **Runtime config** (`wrangler.jsonc`): `main ./worker.ts`, `compatibility_date 2026-05-07`, `compatibility_flags ["nodejs_compat", "global_fetch_strictly_public"]`, `placement: smart`, `logpush` off, `observability` disabled (cost cap). DO migration tag `v2` (`new_classes: ["CronLockDO"]`). Queue consumer also sets `max_batch_timeout 10`.
- **Constraints:** stateless (no global mutable state — coordinate via Durable Objects), 128MB memory, 30s HTTP / 15min cron execution. Cron triggers require `wrangler triggers deploy` (included in `pnpm run deploy`). Always `pnpm run preview` before deploying.

---

## Build, test & dev commands

This project routes everything through `vinext` (app lifecycle) and `vp` (Vite+: lint/format/test/check) — **do not substitute `next`/`vitest`/`eslint`/`prettier` directly.** Package manager is `pnpm@11.10.0`.

```bash
pnpm run dev              # vinext dev server (localhost:3000)
pnpm run build            # vinext production build
pnpm run preview          # vinext build + wrangler dev (test the real Worker locally)
pnpm run deploy           # vinext build + wrangler deploy + wrangler triggers deploy

pnpm run check            # format + lint + type-check (all-in-one; see scope caveat below)
pnpm run check:fix        # auto-fix format/lint, then type-check
pnpm run lint / lint:fix  # Oxlint
pnpm run format           # Oxfmt

pnpm run test             # vitest (vite-plus) watch
pnpm run test:run         # run once (CI mode)
pnpm run test:coverage    # run with coverage (80% threshold required)

pnpm run knip             # find unused exports/dependencies
pnpm run type-check       # AUTHORITATIVE full check: tsc --noEmit && tsc -p tsconfig.worker.json --noEmit
pnpm run generate:og      # regenerate public/og-image.png (satori + resvg)
```

> **`pnpm run check` type-check scope:** `vite.config.ts` excludes `worker.ts` and `scripts/**` from Oxlint's type-aware pass (they need the separate `tsconfig.worker.json` for Cloudflare Workers types). So **`pnpm run check` does NOT type-check `worker.ts` or `scripts/`.** If you touch those, run `pnpm run type-check` (runs both tsconfigs) before committing. There are **two tsconfigs**: `tsconfig.json` (app, DOM, excludes `worker.ts`) and `tsconfig.worker.json` (Workers, `types:[node]`, narrow `include` — **new worker-side files must be added to its `include` array or they're silently un-typechecked**).

**Tests** (`vitest.config.ts`, jsdom, 80% v8 threshold on branches/functions/lines/statements + typecheck): split into `tests/unit/` (pure fns, orchestration, `CronLockDO`, DB wrappers) and `tests/integration/` (API route handlers called directly, `proxy`/middleware, `worker.ts` queue/scheduled). The two unresolvable virtual modules — `cloudflare:workers` and `vinext/server/app-router-entry` — are aliased to `tests/mocks/*` in `vitest.config.ts`; individual tests override `cloudflare:workers` via `vi.mock` to inject bindings. **Import test utils from `'vite-plus/test'`, not `'vitest'`.** Re-export the ASU error subclasses in mocks (production branches on `instanceof`). Run one file: `pnpm exec vitest run tests/unit/lib/utils.test.ts`. **#352 consolidation:** four integration suites (`class-watches`, `data-rights`, `onboarding`, `onboarding-popular-class`) remain `@ts-nocheck` skipped placeholders for the Clerk seam (#354 deleted six more dead auth suites: totals now ~63/7 files, ~705/108 tests; coverage exclusions for `lib/auth/clerk-session` + `lib/db/users` + `lib/clerk/config` stand until follow-up unit tests land). Intentional follow-up, not regression.

**Pre-commit** (`core.hooksPath=.husky`): the operative logic lives in **`.vite-hooks/pre-commit`** (managed by `vp config`): runs `vp staged` + `pnpm run type-check`, **skipped entirely when `$CI` is set** — so CI must (and does) re-run these independently.

---

## CI (`.github/workflows/ci.yml`)

Runs on push/PR to `main` (`concurrency` cancels in-progress). Jobs:

1. **`validate-lockfile`** — `pnpm install --frozen-lockfile`, fails if `pnpm-lock.yaml` drifts from `package.json`. Gates everything else.
2. **`quality`** — `pnpm run check` (format + lint + app type-check via Oxlint).
3. **`test`** — `pnpm run test:coverage` (80% threshold).
4. **`check`** — `tsc --noEmit` (app) **and** `tsc -p tsconfig.worker.json --noEmit` (worker) **and** `pnpm exec knip` **and** `pnpm run build`.
5. **`ci-success`** — `needs: [all]`, `if: always()`, fails unless every job succeeded. This is the required status check.

All five jobs (`validate-lockfile`, `quality`, `test`, `check`, `ci-success`) must pass to merge (`ci-success` is the required check; the other three run in parallel after `validate-lockfile`). Dependabot (`npm` + `github-actions`, daily) groups minor/patch into one `all-minor-patch` PR but **ignores `vite-plus`** — it ships as lockstep packages (`vite-plus` + npm-aliased `vite`=`@voidzero-dev/vite-plus-core` + plain `vitest`, whose major must match the `vitest` that `vite-plus` bundles) that must be bumped manually in sync or CI breaks. The `pnpm-workspace.yaml` overrides keep `vite-plus`, the aliased Vite core, `vitest`, and `@vitest/coverage-v8` in sync; update those pins together after checking the versions bundled by Vite+ (`vp --version` / `node_modules/vite-plus/docs/guide/upgrade.md`).

---

## Generated files (keep in sync)

| File | Command | When to regenerate |
|------|---------|-------------------|
| `lib/cloudflare-env.d.ts` | `pnpm run cf-typegen` | After changing `wrangler.jsonc` (add `HYPERDRIVE`, `CLERK_*` secrets are hand-typed, not generated) |

**Secrets** never appear in generated CF types — hand-type them in `lib/cloudflare-env.supplemental.d.ts` (augments `Cloudflare.Env` + `NodeJS.ProcessEnv`).

---

## Conventions
- **API responses:** use `ok()`/`fail()` from `lib/api/response.ts` (`ok` spreads data at the top level alongside `success:true`). **Only two routes are exempt** (they have external/contractual shapes): `monitoring/health`, `queue/process-section`.
- **Validation:** zod `safeParse` + `mapValidationIssues` → `fail('Invalid input', 400, details)`. Schemas live in `lib/api/schemas.ts`.
- **Auth in routes:** `requireUser(request)` / `getSessionIdentity(request)` (Clerk JWT via `lib/auth/clerk-session.ts`) → `UnauthorizedError` → `fail('Unauthorized',401)`; cron/queue → `verifyCronSecret`.
- **Client choice:** service client only where bypassing RLS is intended; RLS server client for user-scoped work; never expose the service client to the browser.
- **Email/lowercasing:** lowercase email before any auth op (Clerk lookups, lockout accounting on their side).
- **Redirect params** from query strings must be sanitized like `/auth/post-oauth` (start with `/`, reject `//` and `/\`).
- **Style:** Oxfmt/Oxlint, 2-space indent, width 100, single quotes, semicolons, camelCase (vars/fns) / PascalCase (types/components), imports auto-organized. Run `pnpm run check:fix` before committing.
- **Tests:** colocated under `tests/` (not next to source), `*.test.ts(x)` / `*.spec.ts(x)`.

---

## Commit & PR guidelines

- **[Conventional Commits](https://www.conventionalcommits.org/):** `type(scope): description`. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `security`. Branches: `feature/`, `fix/`, `docs/`, `refactor/`.
- **PRs:** all CI checks pass; use the template; no `console.log` debugging or hardcoded secrets/URLs; **squash and merge to `main`.**
- Don't add/remove/upgrade dependencies unless asked; if you do, commit `package.json` + `pnpm-lock.yaml` together (`pnpm install`, verify with `--frozen-lockfile`).

---

## Critical invariants & gotchas (the do-not-break list)

- **`processSection` ordering** (reset → upsert `class_states` → send) is the email-dedup backbone. Move the send earlier and retries double-send.
- **Email exactly the watch IDs returned by `tryRecordNotificationsBatch`** (the claimed set), and **roll back failed sends** with `deleteNotificationRecords`, or users are suppressed for 24h.
- The **daily `expire_stale_notifications()` cron is load-bearing** — without it, re-notifications stop after 24h.
- **`processSection` owns the ack/retry verdict** (`SectionCheckOutcome.disposition` in `lib/queue/process-section.ts`); `worker.ts queue()` and `app/api/queue/process-section/route.ts` only translate `outcome.disposition` to their transport (queue `ack()`/`retry()` vs HTTP `200`/`429`/`502`). Single decision table, no hand-policed "keep identical" comment. The HTTP route returns `200` for `ack` (drop) *on purpose*; returning 4xx/5xx for an `ack` verdict would cause infinite retries.
- **`class_states` is keyed on `(class_nbr, term)`** — always include `term`.
- **`proxy.ts` is the auth gate** (sole vinext middleware; Clerk `authenticateRequest` with `jwtKey`, `hasClerkSessionCookies` fast-path, `ext_id` claim). Authorization State (`{is_admin,is_disabled,has_consent}`) owned by `lib/auth/authorization-state.ts` (cached edge read / fresh admin read, 30s per-isolate cache); invalidate via `invalidateAuthorizationState` after consent/admin changes. `lib/clerk/config.ts` literal `CLERK_PUBLISHABLE_KEY` is the only publishable key. Sign-in/up are hosted Clerk components at `/sign-in`/`/sign-up` — there are no app login/register routes to reintroduce.
- **First-observation guard** (`!oldState`) prevents false "seat available" emails — keep it; note it triggers on row *existence*, not content.
- **`non_reserved_seats` is populated since issue #198** (ASU client computes `Math.max(0, enrlCap - enrlTot - waitTot)`, `upsertClassState` persists it); when NULL, `detectChanges` falls back to `seats_available`. Keep the column and the `?? seats_available` fallback.
- **`lib/asu/terms.ts` needs yearly (August) maintenance**; lapsing silently blocks new watches.
- **Never add a dynamic API to `app/layout.tsx`** (static pages 500). Pages reading `useSearchParams` must be `<Suspense>`-wrapped.
- **`MAX_WATCHES_PER_USER`** is enforced atomically in the `create_class_watch_with_limit` RPC (advisory lock), not just the app pre-count.
- All user data in **email templates must be `escapeHtml`'d**; rotating `UNSUBSCRIBE_SIGNING_SECRET` invalidates all existing unsubscribe links.

## Known doc drift (verify against code)
`README.md` and `CONTEXT.md` were drift-pruned for Hyperdrive + Clerk (2026-08-22): architecture now shows PlanetScale via `HYPERDRIVE` + `CLERK_*` + polling (not Supabase Realtime), `# tech stack` lists `pg`/`@clerk/backend`/`@clerk/react` (not `@supabase/supabase-js`). #354 then removed all Supabase code/deps, moved migrations to `db/migrations/`, and replaced the `/login`-family pages with hosted `/sign-in`/`/sign-up`. Remaining drift risk is hard numbers/prose — confirm against `wrangler.jsonc`/code. History: queue "internal HTTP" → direct `processSection()` (ADR 0006), dedup "INSERT…ON CONFLICT" → partial-index + `try_record_notifications_batch` (ADR 0004), Realtime → polling (ADR 0014), Supabase Auth → Clerk (ADR 0012), PostgREST → Hyperdrive `pg` (ADR 0013).

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
