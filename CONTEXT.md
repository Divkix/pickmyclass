# Domain Vocabulary

This document defines domain terms used throughout the codebase. New modules should use these terms consistently.

## Core Concepts

- **Class Section** — An ASU course section, identified by `class_nbr` (5-digit) + `term` (4-digit YYSM code, e.g. "2261" for Spring 2026). Each section is a single offering of a course with a specific instructor, schedule, and seat capacity. The class picker shows only the current and next selectable terms, driven by the ASU academic calendar in [`lib/asu/terms.ts`](./lib/asu/terms.ts). Extend that calendar each August when ASU publishes the next academic year.

- **SectionRef** — The identity of a Class Section: the `{ class_nbr, term }` pair that Class State, Class Watch, and every pipeline stage are keyed by. A section number repeats across terms, so a SectionRef always carries both fields — neither identifies a section alone.
  _Avoid_: "section number" / "class_nbr" when you mean the whole identity; bare `(class_nbr, term)` tuples.

- **Class Watch** — A user's subscription to monitor a Class Section for changes. Each watch belongs to one user and targets one section. Users are limited to `MAX_WATCHES_PER_USER` (default: 10).

- **Class State** — A cached snapshot of a Class Section's current data stored in the `class_states` table. Updated during each section check. Contains seats, instructor, location, and meeting times. Not authoritative — the ASU API is the source of truth.

## Notifications

- **Notification** — An email alert sent when a watched section changes. Two types: `seat_available` (seats opened up) and `instructor_assigned` (instructor changed from "Staff" to a named professor).

- **Notification Dedup** — Ensuring each watcher receives at most one notification per change type per cycle. Implemented atomically via the `try_record_notifications_batch` DB RPC, with stale-record cleanup and rollback on email failure.

- **Notification Eligibility** — Whether a watcher may receive email, based only on explicit notification preference, bounce/spam state, and account status. Delivery success is not treated as evidence that a user opened or engaged with an email.

## Processing Pipeline

- **Section Check** — One complete cycle of: fetch current state from DB → fetch latest data from ASU API → detect changes → send notifications → persist state. Each section check processes a single `class_nbr`.

- **Change Detection** — The algorithm that compares old and new section data to determine if seats became available, seats filled, or an instructor was assigned. The seat signal is `non_reserved_seats ?? seats_available`; `non_reserved_seats` is computed as `Math.max(0, enrlCap - enrlTot - waitTot)` in `lib/asu/api.ts` and persisted via `upsertClassState` (`lib/db/queries.ts`), with fallback `non_reserved_seats ?? seats_available` when `NULL` (no waitlist data) — see `docs/adr/0005-non-reserved-seats-dormant-column.md` (pre-#198 wording is historical).

- **Cron Cycle** — The every-30-minute scheduled job (`/api/cron`) that enqueues Section Checks. Partitioned by Stagger Group.

- **Stagger Group** — Even/odd class_nbr partitioning to spread checks across two cron triggers (:00 = even, :30 = odd). Reduces load on the ASU API.

- **Queue Message** — A `ClassCheckMessage` containing `class_nbr`, `term`, `enqueued_at`, and `stagger_group`. Sent to Cloudflare Queue for parallel processing.

- **Disposition** — The retry-vs-give-up verdict for one Section Check: `ack` (done, drop the message) or `retry` (transient, try again). Decided inside `processSection` (returns `SectionCheckOutcome` with `disposition: 'ack'|'retry'`); the queue consumer and HTTP mirror each translate `outcome.disposition` to their transport (queue `ack()`/`retry()` vs HTTP `200`/`429`/`502`/`500`). See `docs/adr/0006-queue-ack-retry-contract.md`.

## Architecture

- **Seam** — Where behaviour can be altered without editing in place (e.g., the `fetchClassFromASU()` function provides a seam at the ASU API boundary).
- **Adapter** — A concrete implementation satisfying an interface at a seam (e.g., `TtlCache` is an adapter around `Map` with expiry logic).

## Auth & Security

- **Authorization State** — A user's `{ is_admin, is_disabled, has_consent }` state derived from `user_profiles`. Server-side gates use it for admin access, disabled-account enforcement, and the legal-consent gate. Owned by `lib/auth/authorization-state.ts`, which exposes a cached edge read, fresh authoritative reads, and cache invalidation. The browser `AuthContext`'s `is_admin` is a UI affordance only.
  _Avoid_: "profile" when you mean only authorization state.

- **Lockout** — Account lockout protection after 5 failed login attempts. Prevents brute-force attacks.
- **Disposable Email Domain** — A temporary email service domain blocked during registration. Blocklist synced daily from GitHub.
- **Admin Role** — Special user role for admin dashboard access. Checked via `lib/auth/admin.ts`.
- **OAuth Callback** — Clerk OAuth handler at `app/auth/callback/page.tsx` (`AuthenticateWithRedirectCallback`) + `app/auth/post-oauth/route.ts` (consent + mirror).
- **Clerk Session** — Edge JWT verification via `@clerk/backend` (`lib/auth/clerk-session.ts`, `ext_id` claim `{{user.external_id || user.id}}`, `jwtKey` PEM) and cookie fast-path (`lib/auth/clerk-cookies.ts`, `__session`); publishable key literal in `lib/clerk/config.ts`. See `docs/adr/0012-auth-plane-clerk.md`.
- **Users Mirror** — Clerk users mirrored to `users` + `user_profiles` via Svix webhook `POST /api/webhooks/clerk` (`lib/db/users.ts`, `clerk_user_id` unique, `externalId` preserves old Supabase UUID).
- **Polling** — Dashboard live states via polling `GET /api/class-watches/states` (`useRealtimeClassStates`), not Supabase Realtime (`docs/adr/0014-realtime-to-polling.md`).

## Compliance

- **CCPA Compliance** — California Consumer Privacy Act compliance features: data export (`/api/user/export`) and soft-delete (`/api/user/delete` with 30-day retention).
- **CAN-SPAM Compliance** — Email unsubscribe compliance with RFC 8058 one-click unsubscribe.
- **Data Rights** — User rights to access and delete their data.

## Caching

- **TTL Cache** — Time-to-live cache for ASU API responses. Default 2-minute TTL. Located in `lib/cache/ttl-cache.ts`.

## API & Validation

- **API Schema** — Zod schema for validating API inputs. Located in `lib/api/schemas.ts`.
- **ClassCheckMessage** — Queue message type containing `class_nbr`, `term`, `enqueued_at`, `stagger_group`.

## Email System

- **Email Batch** — Batched email sending via Cloudflare Email Service. Max 5 messages per batch.
- **Unsubscribe Token** — HMAC-signed token for one-click unsubscribe. Expires after 30 days.
- **Clerk Webhook** — Svix `verifyWebhook` at `POST /api/webhooks/clerk` for `user.created/updated/deleted` (secret `whsec_...`, 2xx fast; retries on 4xx/5xx).
- **Data Plane** — PlanetScale Postgres via Hyperdrive (`pg` 8.23, `--caching-disabled`, 5-conn pool `lib/db/client.ts`, `docs/adr/0013-data-access-hyperdrive.md`), not Supabase PostgREST.

## Durable Objects

- **CronLockDO** — Durable Object that prevents duplicate cron executions. Auto-expires after 25 minutes.

## Onboarding
 
- **Onboarding Flow** — The first-time experience shown after email verification on the first dashboard visit. It teaches the user how to find an ASU class number and create their first watch. Implemented as a blocking modal with a linear checklist.
- **Onboarding Step** — One of the three stages of the Onboarding Flow: find a class ID, add a watch, and confirmation. Steps are sequential and cannot be skipped individually.
- **Onboarding Completion** — The state in which the user has created their first watch. Persisted in `user_profiles.onboarding_completed_at` and hides the Onboarding Flow and the Finish Setup Card.
- **Onboarding Skip** — The state in which the user dismissed the Onboarding Flow via Escape, backdrop click, or the Skip button. Persisted in `user_profiles.onboarding_skipped_at` and keeps the Finish Setup Card visible.
- **Popular Class Example** — A real, currently-watched `(class_nbr, term)` surfaced in step 1 to give the user a one-click shortcut. Sourced by the `get_most_watched_class` RPC and validated against the ASU API when the modal loads.
- **Finish Setup Card** — A compact dashboard card shown after the user skips the Onboarding Flow. It remains until the user creates their first watch, at which point Onboarding Completion is reached.
- **Simplified Watch Form** — The class-watch form used inside the Onboarding Flow. It contains only `class_nbr` and `term`, unlike the full dashboard form, but submits through the same `create_class_watch_with_limit` RPC.

## UI Components

- **shadcn/ui** — UI component library used for base components (button, card, dialog, etc.).
- **Landing Components** — Marketing page components (hero, features, social proof, CTA).
- **Admin Components** — Dashboard tables with filtering, sorting, and pagination.

## Blog System

- **Blog Post** — Static blog post with Table of Contents, FAQ schema, and comparison tables.
- **RSS Feed** — XML feed at `/blog/feed.xml`.

## Utilities

- **cn()** — shadcn/ui utility function combining `clsx` and `tailwind-merge` for conditional class names.
- **Timing Safe Compare** — Constant-time string comparison for secret validation (prevents timing attacks).

## Infrastructure

- **Queue Consumer** — Cloudflare Queue consumer (`max_concurrency: 20`, `max_batch_size: 5`). `worker.ts queue()` calls `processSection()` directly (no HTTP); `app/api/queue/process-section/route.ts` is an HTTP mirror for tests/HTTP dispatch (`docs/adr/0006-queue-ack-retry-contract.md`). Data plane is PlanetScale via Hyperdrive (`lib/db/client.ts`), not Supabase; live dashboard is polling (`docs/adr/0014-realtime-to-polling.md`).
- **Dead Letter Queue (DLQ)** — Queue for failed messages that exceeded max retries (always ack, admin alert to `ALERTS_FROM_EMAIL`).
