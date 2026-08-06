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

**PickMyClass** notifies ASU students by email when a seat opens (or an instructor is assigned) in a class section they watch. It's a **Next.js 16 App Router** app (React 19, TypeScript strict) deployed on **Cloudflare Workers via the `vinext` adapter** (Vite-based Next.js — *not* `@cloudflare/next-on-pages` or OpenNext), backed by **Supabase** (Postgres + Auth + Realtime, accessed over HTTP — no Hyperdrive), with **Cloudflare Email Service** for all transactional email and **Cloudflare Queues + a Durable Object** for the seat-checking pipeline. Tooling is **Vite+ (`vp`)** and the package manager is **`pnpm@11.10.0`**.

The two systems worth understanding before anything else are the **seat-check notification pipeline** and the **auth/account lifecycle** (both below).

---

## Architecture at a glance

```
Browser ──> vinext app (Cloudflare Worker: worker.ts) ──> Supabase (Auth + Postgres + Realtime)
                          │                                        ▲
   Cloudflare Cron ───────┤                                        │ Supabase Realtime → live dashboard
   0,30 * * * * (checks)  │                                        │
   0 4 * * *   (daily)    ▼
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

**Correction vs README/CONTEXT.md:** the live queue consumer is `worker.ts queue()`, which calls `processSection()` **directly** (not internal HTTP). `app/api/queue/process-section/route.ts` is a maintained **mirror** for HTTP-dispatched processing / tests; both derive their verdict from the pure `classifyDisposition` (`lib/queue/disposition.ts`) so they can't drift. Rationale + decision table: `docs/adr/0006-queue-ack-retry-contract.md`.

---

## Pipeline 1 — Seat-check notifications (the core)

Files: `worker.ts`, `app/api/cron/route.ts`, `lib/queue/*`, `lib/asu/api.ts`, `lib/db/queries.ts`, `lib/email/send.ts`, the notification RPCs in `supabase/migrations/*`.

1. **Cron trigger** (`wrangler.jsonc` crons `0,30 * * * *` and `0 4 * * *`) → `worker.ts scheduled()`. It routes `0 4 * * *` → `/api/cron/update-disposable-domains`, everything else → `/api/cron`, via an internal `handler.fetch()` with `Authorization: Bearer ${CRON_SECRET}` and **`X-Cron-Scheduled-Time`** (the scheduled ms). It logs `CRON_PARTIAL_FAILURE` on `!ok || 207` but never throws (Cloudflare cron has no auto-retry).
2. **`/api/cron`**: `verifyCronSecret` (timing-safe) → `createCronLockClient` acquires the single global **`CronLockDO`** lease (auto-expires after **25 min** < the 30-min cadence) — not acquired ⇒ `409`, no enqueue; missing binding deliberately fails open. The client in `lib/worker/cron-lock.ts` hides DO identity/URLs/wire parsing and the lease owns release. Computes **stagger group** from `X-Cron-Scheduled-Time` (`:00` = even, `:30` = odd by last digit of `class_nbr`) so a *delayed* cron still maps to the right window. `getSectionsToCheck(stagger)` (RPC) returns distinct `(class_nbr, term)` with active watchers. Enqueues `ClassCheckMessage` in **batches of 100** (CF `sendBatch` hard limit) with exactly **one** retry pass; partial failure ⇒ `207`. Lease released in `finally` (errors swallowed; relies on the 25-min auto-expiry). Sections whose term has ended are dropped here via the **`getPastTermCodes()` → `Set` → `.filter(s => !pastTerms.has(s.term))`** enqueue filter so they never hit ASU; the daily 4 AM job additionally **hard-deletes** past-term `class_watches` (cascades to `notifications_sent`) using the same set. Both rely on `ASU_TERM_CALENDAR` retaining retired terms — never prune past terms from it. ASU 404s are still acked (non-retryable); they are not used as a deletion signal because a single 404 can be transient. Boundary: `docs/adr/0011-cron-lock-lifecycle-boundary.md`.
3. **`worker.ts queue()`** consumer (config: `max_batch_size 5`, `max_concurrency 20`, `max_retries 3`, `retry_delay 60s`, DLQ `pickmyclass-dlq`). For `pickmyclass-dlq` → `handleDLQMessage` then **always ack**. Otherwise `processSection()` per message, then `classifyDisposition()` (`lib/queue/disposition.ts`) maps the try-result **or** caught error to a `Disposition` (`'ack' | 'retry'`) that the consumer/HTTP route each translate to their transport. Decision table + why `ack→200`: `docs/adr/0006-queue-ack-retry-contract.md`.
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

## Pipeline 2 — Auth & account lifecycle

Files: `app/api/auth/*` (6 routes: `register`, `login`, `signout`, `check-lockout`, `consent`, `send-email-hook` — **there is no `logout`/`reset-password` server route**), `app/auth/callback/route.ts`, `app/consent/page.tsx`, `lib/auth/*`, `lib/supabase/*`, `lib/email/auth-templates.ts`, `lib/contexts/AuthContext.tsx`, `proxy.ts`, and the `user_profiles` / `failed_login_attempts` migrations.

- **Register** (`/api/auth/register`): zod `registerSchema` (password ≥8, `ageVerified===true`, `agreedToTerms===true`), lowercase email, disposable-email KV check (**fails open** — verification email is the real gate), `signUp` with `emailRedirectTo` + consent in user metadata. Duplicate email is detected by **`data.user.identities.length===0`** (a Supabase quirk) ⇒ `409`. **Consent is persisted by the `handle_new_user()` Postgres trigger** from `raw_user_meta_data`, *not* a client RPC — with email confirmation on there's no session yet, so `auth.uid()` is `NULL` and a client UPDATE matches zero rows (fixed in migration `20260618120000`).
- **Google OAuth consent**: register OAuth carries `consent=confirmed` to `/auth/callback`, which exchanges the code then invokes the authenticated `accept_terms_and_verify_age()` RPC before redirecting. Google sign-in without that marker (including accounts created through the login page) reads the profile and sends any account missing either timestamp to the protected `/consent` gate. `/api/auth/consent` re-validates both confirmations, records missing timestamps atomically, and invalidates `AuthorizationState`; `proxy.ts` blocks verified users with `has_consent=false` from protected pages. Existing OAuth accounts are repaired on their next sign-in rather than silently backfilled.
- **Auth emails** go through Supabase's **Send Email Hook** → `/api/auth/send-email-hook`: verifies `standardwebhooks` signature with `SUPABASE_SEND_EMAIL_HOOK_SECRET` (`normalizeHookSecret` strips a leading `v1,`), builds messages via `buildAuthEmailMessages` (an `email_change` action emits **two** emails), sends via `env.EMAIL`, returns a raw `{}` (exempt from the `ok()/fail()` envelope). **Missing `EMAIL` binding or hook secret ⇒ 500 and signup silently stalls.**
- **Verify / callback** (`/auth/callback`): `exchangeCodeForSession`; the `next` param is open-redirect-guarded (must start with `/`, reject `//` and `/\`).
- **Login** (`/api/auth/login`): the route supplies credential/disabled-account authentication to the deep `loginAttemptPolicy.attempt(email, authenticate)` seam and only maps its decision to HTTP. The policy owns email normalization, pre-check (locked ⇒ `423`, no Supabase Auth call), expiry, atomic increment + re-check, remaining-attempt math, and clearing after success. The authentication adapter checks `is_disabled` via the **fresh** `readAuthorizationState(supabase, id, { cache: false })` (⇒ `signOut` + `403`). **Lockout** = `failed_login_attempts` (**RLS enabled, zero policies ⇒ service-role only**), **5 attempts / 15 min**, via the policy's internal Supabase adapter and atomic `increment_failed_attempts` RPC (granted to `service_role` only).
- **`check-lockout`**: unauthenticated; **deliberately omits the raw attempts count** (SEC-02 enumeration oracle) and has **no in-app rate limiting** — relies on a **Cloudflare WAF rate-limit rule (~20 req/min/IP)**. Don't remove that rule, don't add `attempts` back. Why: `docs/adr/0007-check-lockout-enumeration-guard.md`.
- **Sessions:** server `lib/supabase/server.ts createClient()` (anon key + RLS, cookie-bound; `setAll` swallows the Server-Component write error and relies on `proxy.ts` to refresh). `requireUser()` throws `UnauthorizedError(401)` for API routes. Client `AuthContext` calls `getUser()` **before** `getSession()` (an authenticated round-trip that honors HTTP-only cookies set server-side), and queries `is_admin` in a separate effect keyed on `user.id` (not the user object, to skip redundant queries on token refresh). `isAdmin` here is a **UI affordance only — never a security boundary.**
- **Admin gating is layered (defense in depth):** `proxy.ts` edge redirect + `verifyAdmin()` in `app/admin/layout.tsx` *and* each admin page + Postgres RLS. `verifyAdmin()` `redirect()`s (not throws) — RSC/layout use only. It reads via the **fresh** `readAuthorizationState(supabase, id, { cache: false })` so a demoted/disabled admin is enforced immediately on admin pages.
- **Authorization State** (`{ is_admin, is_disabled, has_consent }`) is owned by one server-only module `lib/auth/authorization-state.ts`: `readAuthorizationState(client, userId, { cache })` (a **cached** read for the edge proxy, a **fresh** read for `verifyAdmin`/login), plus `invalidateAuthorizationState(userId)` and the **30s per-isolate cache** (moved out of `proxy.ts`; it's now just a reader). `has_consent` is derived from both legal timestamps and gates protected pages; invalidate after recording consent. The browser `AuthContext` admin hint stays separate (UI affordance only — the per-isolate cache can't cross into the browser). Boundary recorded in `docs/adr/0001-authorization-state-boundary.md`.
- **Password reset** has **no server route** — fully client-side via the Supabase browser client (`resetPasswordForEmail` → `/auth/callback?next=/reset-password` → `updateUser({password})`). `proxy.ts` intentionally allows `/reset-password` while email is unconfirmed and excludes it from `AUTH_PAGES` — don't "fix" this. Why: `docs/adr/0008-password-reset-no-server-route.md`.
- **Account deletion** (`/api/user/delete`): **CCPA soft-delete** (30-day retention) — service client sets `is_disabled/disabled_at/notifications_enabled=false/unsubscribed_at` (those columns are RLS-restricted, hence service role), calls `invalidateAuthorizationState(userId)` (from `lib/auth/authorization-state.ts`, **not** `@/proxy`), then `signOut`. **Export** (`/api/user/export`): anon RLS client, JSON attachment, `Cache-Control: no-store`.

---

## The edge auth gate (`proxy.ts`)

| File | Role | Matcher |
|------|------|---------|
| **`proxy.ts`** | **THE auth gate** (vinext's middleware convention — `proxy.ts` is the only middleware file; vinext picks it over a `middleware.ts` and 0.1.7+ errors if both exist. Exported as `proxy`, `middleware`, and `default`). `getUser()`, redirects (disabled→signout, unverified→`/verify-email`, unauthenticated-protected→`/login`, authed-on-auth-page→dashboard/admin, admin-on-`/dashboard`→`/admin`), **per-request CSP nonce** + all security headers (X-Frame-Options, HSTS in prod, etc.), and the **cached** `readAuthorizationState` (30s per-isolate cache now owned by `lib/auth/authorization-state.ts`, not `proxy.ts`). | catch-all |

- Caching has **three layers**: `lib/worker/edge-html-cache.ts` owns the **edge HTML cache** (Cache API `caches.default`; `worker.ts fetch()` only adapts vinext + `ctx.waitUntil`; anonymous GETs to `/`, `/faq`, `/about`, `/blog`, `/blog/*`, `/legal`, `/legal/*` — a HIT skips `proxy.ts` + the RSC render entirely; the big CPU saver, and the **only** thing setting `Cache-Control` on HTML), **`public/_headers`** (static assets — fonts/images `immutable` 1yr; `llms.txt`/`llms-full.txt`/og-image with SWR), and the Cloudflare edge. The module's three-operation seam (`isEligible`, `get`, `put`) hides pathname+version-id keying, anonymous/200/no-`Set-Cookie` rules, **RSC exclusion + HTML-only storage** so a flight payload can't poison the entry, frozen-nonce behavior, and `EDGE_HTML_CACHE_TTL_S` 1h. Rationale: `docs/adr/0009-edge-html-cache-rsc-exclusion.md` (supersedes `0003`). Add worker-side files to `tsconfig.worker.json` explicitly.
- Security/CSP/redirects live in `proxy.ts` (the sole edge gate).
- The Supabase **URL + anon key are hardcoded inline in THREE places**: `lib/supabase/config.ts`, `proxy.ts`, and `app/auth/callback/route.ts`. Changing the Supabase project requires editing all three (the anon key is public/RLS-gated, so this is safe to ship).
- **PostHog project token** is a public client constant in `lib/posthog/config.ts` (same rationale as the Supabase anon key). Client init (`instrumentation-client.ts`) and server capture (`lib/posthog-server.ts`) import from there — do **not** rely on `process.env.NEXT_PUBLIC_POSTHOG_*` alone for the browser: those are build-time-only, and wrangler `vars` are runtime-only, so a deploy without the env at build time inlined `undefined` and dropped all client events. Both clients send directly to `https://us.i.posthog.com`; do not add a same-origin external rewrite because vinext forwards request credentials through external rewrites. The browser imports `posthog-js/dist/module.no-external` plus the bundled `exception-autocapture` extension so exception capture stays active, unused extensions stay out of the main chunk, and CSP never needs to allow runtime code from PostHog asset hosts.
- The production CSP whitelists next-themes' inline no-flash script via a specific **sha256 hash** in `proxy.ts` — changing that script breaks CSP/theme-flash until the hash is regenerated. RSC inline scripts (JSON-LD in `app/layout.tsx`) read the nonce from `next/headers` (`x-nonce`); never add `'unsafe-inline'`.
- After mutating an authorization field (`is_admin`/`is_disabled`), call `invalidateAuthorizationState(userId)` (from `lib/auth/authorization-state.ts`) or `proxy.ts` serves a 30s-stale decision.

---

## Data layer — Supabase

**Three client flavors, three trust levels** (`lib/supabase/`):

| Client | Key | RLS | Use |
|--------|-----|-----|-----|
| `client.ts createClient()` | anon | enforced | Client Components (browser) |
| `server.ts createClient()` (async) | anon, cookie-bound | enforced (runs as the user) | Server Components / user-scoped route handlers |
| `service.ts getServiceClient()` | **service role** | **BYPASSED** | cron/queue pipeline, admin queries, RLS-restricted columns. **Server-only — never import into a client bundle.** Cached singleton; `autoRefreshToken/persistSession = false`. |

- **RPC-first data access.** Heavy reads/writes (watcher lookups, section enumeration, dedup, admin pagination, counts, activity) run as **`SECURITY DEFINER` Postgres functions**, so filtering/joins/aggregation stay in SQL and the service role can safely read emails out of `auth.users`. Dead single-record/count/engagement RPCs were removed in migration `20260712000005`. Admin pagination RPCs (`get_users_page`/`get_classes_page`) return the page **plus** a `total_count` on every row (read `data[0].total_count`) and whitelist sort columns through static `CASE` expressions. `get_classes_page` groups watcher and notification counts by the full SectionRef (`class_nbr`, `term`), never `class_nbr` alone.
- **Tables (5):** `class_watches`, `class_states`, `notifications_sent`, `user_profiles`, `failed_login_attempts`. **`class_states` is unique on `(class_nbr, term)`** — *not* `class_nbr` alone (a section number repeats across terms; fixed in `20260520000000`). Every `class_states` upsert/lookup must include `term`.
- **`user_profiles`** is 1:1 with `auth.users` via the `on_auth_user_created` trigger and holds `is_admin`, `is_disabled`, consent timestamps, `notifications_enabled`/`unsubscribed_at`, `email_bounced`/`spam_complained`, and `onboarding_completed_at`/`onboarding_skipped_at` columns. A `prevent_user_profile_escalation` trigger silently forces privileged columns back to `OLD` for non-service roles (client writes to `is_admin` etc. **no-op silently**, not error).
- **Onboarding state** (`onboarding_completed_at`/`onboarding_skipped_at`, both nullable): new users get NULL for both and see a blocking **3-step `OnboardingModal`** on the dashboard — Step 1 "Find a class ID" (ASU catalog link), Step 2 "Add the watch" (a `SimplifiedWatchForm` with class number + term only), Step 3 "You're all set" confirmation (closes on next click → `onCompleted` adds the watch locally and drops the modal + card). `SimplifiedWatchForm`, the dashboard's `AddClassWatch`, and undo all create through **`lib/class-watches/class-watch-creation.ts`**, which owns selectable terms, `createClassWatchSchema` validation, POST encoding, error extraction, and the created-watch result; caller navigation, analytics, onboarding state, and toasts stay outside. The server `/api/class-watches` route and atomic `create_class_watch_with_limit` RPC remain authoritative. Escape/backdrop/Skip (steps 1–2) all POST `/api/user/onboarding` → `skip_onboarding()` RPC (SECURITY DEFINER, authenticated; no-ops if already completed/skipped); a `completedRef` guards the step-3 close so `onCompleted` can't double-fire, and `onSubmittingChange` keeps the modal's `creating` guard active for the entire watch POST so Skip/Back stay disabled. PostHog `onboarding_started`/`onboarding_completed` fire client-side in the modal; `onboarding_skipped` fires server-side in the skip route. After skipping, a `FinishSetupCard` shows until the first watch is created (POST `/api/class-watches` sets `onboarding_completed_at` via the service client when not already completed — this includes skipped users, per ADR 0010; the guard filters only `onboarding_completed_at IS NULL`, not `skipped_at`). Existing users were backfilled to `onboarding_completed_at = NOW()` at migration `20260711000000`, so they never see the modal/card. Onboarding state is exposed both via `/api/user/onboarding` GET and folded into the `/api/class-watches` GET response (`onboarding` field) so the dashboard doesn't need an extra mount-time fetch. The lifecycle (status derivation, `pending→skipped`/`pending→completed`/`skipped→completed` transitions, the first-watch completion guard) is owned by **`lib/onboarding.ts`** (`onboardingStatus`, `toOnboardingState`, `completeOnFirstWatch`, `applyFirstWatchGuard`); routes/components are transport/view adapters — don't re-inline transition rules in the routes or dashboard (issue #307).
- **Onboarding popular-class example** (issue #300): on open, the modal GETs `/api/onboarding/popular-class`, which calls the `get_most_watched_class(p_term)` RPC (SECURITY DEFINER, service_role-only, migration `20260712000000`) for the current selectable term (`getSelectableTerms()[0]`) and validates the top SectionRef via `fetchClassFromASU`. The RPC counts only eligible watchers through `private.is_watcher_eligible` and `ORDER BY COUNT(*) DESC, class_nbr ASC LIMIT 1`. On success the modal shows a "Track this class" card (subject/catalog/title/class #) whose click sets `prefillClassNbr` and advances to step 2 (the `SimplifiedWatchForm` mounts with `defaultClassNbr`). Any failure (no selectable term, no watches, ASU 404/error, RPC error) **fails open to `popularClass: null`** and the modal shows the text-only guide instead — the fetch never blocks onboarding.
- **Watcher eligibility** is owned by the private pure SQL function `private.is_watcher_eligible`: notifications enabled, not bounced, not spam-complained, and account enabled. `get_sections_to_check`, `get_watchers_for_sections`, `get_class_watchers`, and `get_most_watched_class` must call that function rather than copy its predicates; direct pgTAP coverage lives in `supabase/tests/watcher_eligibility.test.sql`. `get_class_watchers` is keyed on the full SectionRef — `(p_class_nbr, p_term)`, not `class_nbr` alone — so the admin class-detail Watchers table and the DLQ alert count don't over-list across terms (fixed in `20260701040540`). `get_watchers_for_sections` is likewise SectionRef-scoped — it takes `section_numbers` **and** `p_term`, so recipient selection for notifications can't cross terms (fixed in `20260712000001`; same defect class as `get_class_watchers`).

**Migrations** (`supabase/migrations/`, Supabase CLI):
- Filenames are timestamp-prefixed (`YYYYMMDDHHMMSS_*.sql`), applied in order; **last definition wins**. To change an applied function, add a **new** migration that `CREATE OR REPLACE` / `DROP+CREATE`s it — **never edit an applied migration**.
- Every sensitive `SECURITY DEFINER` function must `SET search_path = public` and be locked down: `REVOKE EXECUTE FROM PUBLIC/authenticated/anon` then `GRANT EXECUTE TO service_role`. `GRANT` alone is additive and leaves it callable by PUBLIC (the bug fixed in `20260501000000`).
- `notification_type` is always exactly `'seat_available'` or `'instructor_assigned'` (CHECK + re-validated in every RPC). Adding a type means touching the column, the RPCs, and `lib/queue/*` / `lib/db/queries.ts`.
- Workflow: `pnpm exec supabase migration new <name>` → write SQL → `pnpm exec supabase db reset` (local) / `pnpm exec supabase db push` (remote) → **regenerate `database.types.ts`** (see Generated Files).

---

## Subsystem quick-reference

- **ASU client** (`lib/asu/api.ts`): `fetchClassFromASU(ref, env)` is the only network seam. Parses ASU's Elasticsearch envelope (all-UPPERCASE fields), and **must `hits.find(_source.CLASSNBR === classNbr)`** — ASU returns fuzzy matches, so `hits[0]` can be the wrong section. 10s timeout, 2-min per-isolate `TtlCache` (not cross-isolate). Throws the typed error hierarchy `ApiError` ⊃ `AuthError`(401/403) / `RateLimitError`(429) / `NotFoundError` — callers branch on `instanceof` for retry decisions, so never swallow these.
- **ASU terms** (`lib/asu/terms.ts`): a **hand-maintained** academic-calendar table (dates from registrar.asu.edu, all math in `America/Phoenix`, no DST). **Must be extended each August** or `getSelectableTerms()` returns `[]` and new watch creation is silently blocked. Existing watches keep processing because `classCheckMessageSchema` is format-only (no selectable-term refinement, unlike `createClassWatchSchema`/`fetchClassDetailsSchema`).
- **Email** (`lib/email/`): all user data in templates **must** pass through `escapeHtml` (no auto-escaping engine). Unsubscribe tokens are stateless HMAC (`UNSUBSCRIBE_SIGNING_SECRET`, 90-day expiry, **not single-use**) — rotating the secret invalidates all existing links. Notification emails require `UNSUBSCRIBE_SIGNING_SECRET` (the send loop mints a token per email; unset ⇒ hard fail).
- **Browser watch creation** (`lib/class-watches/class-watch-creation.ts`): the only client-side creation seam. It returns options plus `create(input)`, validates with `createClassWatchSchema`, POSTs only the SectionRef, normalizes network/API/malformed-response failures, and returns a validated created-watch shape. Keep navigation, analytics, onboarding state, and toast copy in callers; don't add another `/api/class-watches` POST.
- **Auth helpers** (`lib/auth/`): `requireUser` throws (API routes); `verifyAdmin` redirects (RSC). `verifyCronSecret` uses `timingSafeCompare` (SHA-256 then `timingSafeEqual` — constant-time, no length leak). `loginAttemptPolicy` is the only lockout seam; its Supabase store is internal and unit tests use an in-memory adapter. Lockout + disposable-email both use the **service client**; disposable-email **fails open** at every layer and caches the KV blocklist in module state for 1h (call `_resetCache()` in tests).
- **Blog** (`app/blog/`, `components/blog/`, `lib/blog/posts.ts`): fully **static, hand-authored RSC per post** (no CMS/MDX/`[slug]`), 9 posts, AEO/GEO-first (ShortAnswer + KeyTakeaways + FAQ + Article/Breadcrumb/FAQPage/HowTo JSON-LD via shared `JsonLd`). Adding a post means editing **three+ places**: `app/blog/<slug>/page.tsx`, the `lib/blog/posts.ts` registry (feeds index + `feed.xml` + `sitemap.ts`), and **`public/llms-full.txt`** (asserted by `tests/unit/seo-production-assets.test.ts`). `BlogFAQ` renders the visual FAQ and FAQPage schema from the same `faqItems`.
- **SEO/AEO**: `app/robots.ts` explicitly **allow-lists AI bots** (GPTBot, ClaudeBot, PerplexityBot, …) — intentional. `public/llms.txt`, `llms-full.txt`, `pricing.md` are agent-readable assets. All marketing/content pages use `export const dynamic = 'error'` (static-or-build-fails). **Never add a dynamic API (`headers()`/`cookies()`) to `app/layout.tsx`** — it forces every static page dynamic and they 500.
- **UI** (`components/`): shadcn/ui (new-york, lucide) on Radix + cva + **Tailwind 4 (CSS-first — theme in `app/globals.css`, no `tailwind.config`)**. Brand = ASU maroon (primary) + gold (accent) as oklch tokens. `Button` renders `motion.button` (44px default `h-11`) but a plain Slot when `asChild` (so no tap animation on `asChild`). Admin tables are **URL-searchParams-driven** (server re-queries; only one page in the browser). Realtime via `useRealtimeClassStates` (Supabase `postgres_changes` on `class_states`) — its `classNumbers` input **must be `useMemo`'d** or it infinite-loops, and its state map is keyed by **`sectionRefKey` (`term:class_nbr`), not `class_nbr` alone**, so a section watched in two terms doesn't overwrite itself (same for the admin user-watches join in `getUserWatches`; both consume the dashboard lookups via `classStates[sectionRefKey(watch)]`).
- **Config/logging**: tunable constants live in `lib/config.ts` (from-addresses, `ASU_CACHE_TTL_MS`, `EMAIL_BATCH_SIZE/DELAY_MS`, `UNSUBSCRIBE_TOKEN_EXPIRY_DAYS`, cache TTLs) — don't hardcode at call sites. Use `log('Scope').info|warn|error` instead of `console.*` (the `no-console` lint rule only whitelists `lib/log.ts` and tests).
- **PostHog** (`lib/posthog/config.ts`, `instrumentation-client.ts`, `lib/posthog-server.ts`): product analytics + exception capture. Public token is a committed string constant (see edge-auth section). Server routes emit through `captureServerEvent`, which reuses one client, bounds network attempts, and fails open so analytics outages never fail the application mutation; do not call `shutdown()` in a request. Custom events cover register/login/logout, class watches, unsubscribe, account delete, data export; autocapture/pageviews come free once init has a real token.

---

## Project structure

```
app/          # Routes, pages, API endpoints (App Router, no route groups)
lib/          # Core business logic and utilities
components/   # React components (ui/, admin/, landing/, blog/, + shared root)
tests/        # unit/, integration/, mocks/
worker.ts     # Cloudflare Worker (fetch, scheduled/cron, queue, CronLockDO)
proxy.ts      # vinext middleware — REAL auth gate + security headers + CSP nonce
supabase/     # Supabase CLI config + timestamped migrations
scripts/      # build/utility scripts (e.g. OG image generation)
public/       # static + AEO assets (llms.txt, llms-full.txt, pricing.md, og-image.png)
```

**Key `lib/` sub-modules:** `asu/` (ASU client + terms), `api/` (zod schemas + `ok()/fail()` envelope + validation), `auth/`, `class-watches/` (browser creation seam), `db/` (Supabase queries + admin queries), `supabase/` (3 clients + generated types), `queue/` (process-section, change-detector, notification-sender, dlq-consumer), `worker/` (edge runtime modules), `email/` (send + templates + auth-templates + unsubscribe-token), `cache/`, `hooks/`, `contexts/`, `types/`, `blog/`, `config.ts`, `log.ts`, `animations.ts`.

**Naming collisions to remember:** `lib/utils.ts` holds **only** the shadcn `cn()`; `lib/utils/` is custom utilities (crypto, escape-html, ratemyprofessor, seat-badge, time-format). By design — don't "deduplicate" them.

---

## Cloudflare Workers runtime

- **`worker.ts`** wraps vinext's `app-router-entry` and adds `scheduled` (cron), `queue` (consumer), and the `CronLockDO` Durable Object adapter. Lock lifecycle/status plus the DO client live in `lib/worker/cron-lock.ts`; the class only adapts Durable Object storage + HTTP dispatch. (The worker also strips bodies off GET/HEAD requests — bots send them and the Web API forbids it.) `CronLockDO` must remain a named export, a default-export property, and force-exported via `__durableObjectExports` to defeat tree-shaking; keep those references and the `wrangler.jsonc` migration aligned.
- **Bindings** (`wrangler.jsonc` + `lib/types/env.ts`): `PICKMYCLASS_QUEUE` (→ `pickmyclass-queue`), DLQ `pickmyclass-dlq`, `PICKMYCLASS_CRON_LOCK_DO` (DO), `PICKMYCLASS_DISPOSABLE_DOMAINS` (KV blocklist, synced daily from GitHub; the cron requires ≥1000 domains before overwriting so a bad fetch can't wipe it), `EMAIL` (Cloudflare Email Service, remote), `ASSETS`, `CF_VERSION_METADATA` (`version_metadata` binding — deploy version id, used in the edge HTML cache key). Vars: `MAX_WATCHES_PER_USER` (10), `NOTIFICATION_FROM_EMAIL`, `NEXT_PUBLIC_SITE_URL`.
- **Secrets** (set via `wrangler secret put`, **never** in `wrangler.jsonc`): `SUPABASE_SERVICE_ROLE_KEY`, `ASU_API_BASE_URL`, `ASU_API_TOKEN`, `CRON_SECRET`, `SUPABASE_SEND_EMAIL_HOOK_SECRET`, `UNSUBSCRIBE_SIGNING_SECRET`. These never appear in generated CF types — `env as unknown as Env` casts for them are correct and intentional.
- **Accessing bindings inside routes:** `import { env } from 'cloudflare:workers'` then cast `env as unknown as Env` (or a narrow inline `Pick`). Bindings are **not** passed as route params.
- **Runtime config** (`wrangler.jsonc`): `main ./worker.ts`, `compatibility_date 2026-05-07`, `compatibility_flags ["nodejs_compat", "global_fetch_strictly_public"]`, `placement: smart`, `observability` enabled (head sampling 1). DO migration tag `v2` (`new_classes: ["CronLockDO"]`). Queue consumer also sets `max_batch_timeout 10`.
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

**Tests** (`vitest.config.ts`, jsdom, 80% v8 threshold on branches/functions/lines/statements + typecheck): split into `tests/unit/` (pure fns, orchestration, `CronLockDO`, DB wrappers) and `tests/integration/` (API route handlers called directly, `proxy`/middleware, `worker.ts` queue/scheduled). The two unresolvable virtual modules — `cloudflare:workers` and `vinext/server/app-router-entry` — are aliased to `tests/mocks/*` in `vitest.config.ts`; individual tests override `cloudflare:workers` via `vi.mock` to inject bindings. **Import test utils from `'vite-plus/test'`, not `'vitest'`.** Re-export the ASU error subclasses in mocks (production branches on `instanceof`). Run one file: `pnpm exec vitest run tests/unit/lib/utils.test.ts`.

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
| `lib/supabase/database.types.ts` | `pnpm exec supabase gen types typescript --project-id osopxwuebsefhoxgeojh > lib/supabase/database.types.ts` | After any migration (new tables/columns/RPCs) |
| `lib/cloudflare-env.d.ts` | `pnpm run cf-typegen` | After changing `wrangler.jsonc` (bindings, vars, queues, DO, KV) |

If you see `as unknown as` casts on `.rpc()` with a "not yet in generated types" comment, regenerate `database.types.ts` and remove the cast. **Secrets** never appear in generated CF types — hand-type them in `lib/cloudflare-env.supplemental.d.ts` (augments both `Cloudflare.Env` and `NodeJS.ProcessEnv`).

---

## Conventions

- **API responses:** use `ok()`/`fail()` from `lib/api/response.ts` (`ok` spreads data at the top level alongside `success:true`). **Only three routes are exempt** (they have external/contractual shapes): `monitoring/health`, `auth/send-email-hook`, `queue/process-section`.
- **Validation:** zod `safeParse` + `mapValidationIssues` → `fail('Invalid input', 400, details)`. Schemas live in `lib/api/schemas.ts`.
- **Auth in routes:** `requireUser(supabase)` in try/catch → map `UnauthorizedError` to `fail('Unauthorized', 401)`; cron/queue → `verifyCronSecret`.
- **Client choice:** service client only where bypassing RLS is intended; RLS server client for user-scoped work; never expose the service client to the browser.
- **Email/lowercasing:** lowercase email before any auth/lockout op (it's the PK of `failed_login_attempts`).
- **Redirect params** from query strings must be sanitized like `/auth/callback` (start with `/`, reject `//` and `/\`).
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
- **`worker.ts queue()` and `app/api/queue/process-section/route.ts` both derive their ack/retry verdict from `classifyDisposition` (`lib/queue/disposition.ts`)** — one pure decision table, no hand-policed "keep identical" comment. The HTTP route returns `200` for `ack` (drop) *on purpose*; returning 4xx/5xx for an `ack` verdict would cause infinite retries.
- **`class_states` is keyed on `(class_nbr, term)`** — always include `term`.
- **`proxy.ts` is the auth gate** (the sole vinext middleware file). Supabase URL/anon-key are duplicated in 3 files. Authorization State (`{is_admin,is_disabled,has_consent}`) is owned by `lib/auth/authorization-state.ts` (cached edge read / fresh admin+login read); its 30s cache — invalidate via `invalidateAuthorizationState` after authorization or consent changes.
- **First-observation guard** (`!oldState`) prevents false "seat available" emails — keep it; note it triggers on row *existence*, not content.
- **`non_reserved_seats` is populated since issue #198** (ASU client computes `Math.max(0, enrlCap - enrlTot - waitTot)`, `upsertClassState` persists it); when NULL, `detectChanges` falls back to `seats_available`. Keep the column and the `?? seats_available` fallback.
- **`lib/asu/terms.ts` needs yearly (August) maintenance**; lapsing silently blocks new watches.
- **Never add a dynamic API to `app/layout.tsx`** (static pages 500). Pages reading `useSearchParams` must be `<Suspense>`-wrapped.
- **`MAX_WATCHES_PER_USER`** is enforced atomically in the `create_class_watch_with_limit` RPC (advisory lock), not just the app pre-count.
- All user data in **email templates must be `escapeHtml`'d**; rotating `UNSUBSCRIBE_SIGNING_SECRET` invalidates all existing unsubscribe links.
- Disposable-email and the register flow **fail open** — verification email is the real gate, not a hard block.

## Known doc drift (verify against code)

`README.md` and `CONTEXT.md` are useful for *intent* but predate parts of the current code. Previously-stale claims (queue "internal HTTP", "6 blog posts", generic "atomic `INSERT...ON CONFLICT`" dedup) have been corrected to match code + ADRs 0004/0006. Still treat any hard numbers/architecture prose there as documented intent and confirm against `wrangler.jsonc`/code before relying on them.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
