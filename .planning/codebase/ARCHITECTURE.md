# Architecture

**Analysis Date:** 2026-02-26

## Pattern Overview

**Overall:** Hybrid serverless with distributed background processing

PickMyClass follows a **Next.js 16 frontend with Cloudflare Workers backend** pattern. The core innovation is the separation of HTTP request handling (Next.js/OpenNext) from background job processing (Cloudflare Queue + Cron), with coordinated state management via PostgreSQL + RLS + Realtime.

**Key Characteristics:**
- **Frontend-backend decoupling** - Next.js app runs in Workers, Supabase is source of truth
- **Event-driven processing** - Cron enqueues work, distributed queue consumers process in parallel
- **Atomic deduplication** - Race-condition-safe notification tracking via PostgreSQL functions
- **RLS-enforced security** - All tables use row-level security; service role client only for admin operations
- **Real-time sync** - Supabase Realtime subscriptions push class state changes to browser

## Layers

**Presentation Layer (Browser/Client):**
- Purpose: React 19 UI with Tailwind CSS 4, server components where possible
- Location: `app/`, `components/`
- Contains: Page components, client contexts, UI components (shadcn/ui)
- Depends on: Supabase client, auth context, real-time hooks
- Used by: Users accessing `/dashboard`, `/admin`, `/login`, etc.

**Next.js App Server Layer (Worker Runtime):**
- Purpose: Request routing, API handlers, middleware, authentication
- Location: `app/api/`, `middleware.ts`
- Contains: Route handlers for auth, class watches, cron, queue processing
- Depends on: Supabase service client (via getCloudflareContext), ASU API client, Resend
- Used by: Browser (HTTP), Cloudflare Worker scheduled handler, Cloudflare Queue consumer

**Cloudflare Workers Runtime Layer:**
- Purpose: Custom Worker entrypoint, cron triggers, queue consumer batching
- Location: `worker.ts`
- Contains: OpenNext fetch handler wrapper, scheduled cron handler, queue batch processor, CronLockDO
- Depends on: Next.js app (via internal HTTP calls), Durable Objects
- Used by: Cloudflare Cron (every 30 min), Cloudflare Queue (on message arrival)

**Database & Persistence Layer:**
- Purpose: PostgreSQL with RLS, cached class state, notifications tracking, user profiles
- Tables: `class_watches`, `class_states`, `notifications_sent`, `user_profiles`, `auth.users`
- RLS: All tables enforce row-level policies except via service role
- Functions: `get_class_watchers()`, `get_sections_to_check()`, `tryRecordNotifications()`
- Realtime: Subscriptions on `class_states` channel pushed to browsers

**External Integration Layer:**
- ASU Class Search API: Direct HTTP client in `lib/asu/api.ts` (token auth)
- Resend Email: Batch API client in `lib/email/resend.ts` (API key auth)
- Supabase Auth: Session cookies, JWT tokens via `@supabase/ssr`

## Data Flow

**User Registration Flow:**
1. User submits email/password via `POST /api/auth/register`
2. Route calls Supabase auth.signUpWithPassword()
3. Auth trigger creates row in `user_profiles` table
4. Email sent to verify address (Supabase built-in)
5. Middleware redirects to `/verify-email` until confirmed

**Adding a Class Watch (Happy Path):**
1. User enters class number on `/dashboard/add`
2. Client-side validation checks max watches limit (via API response)
3. `POST /api/class-watches` creates row in `class_watches` table
4. Database generates unique `watch_id`, sets `user_id` and `class_nbr`
5. `POST /api/fetch-class-details` fetches live data from ASU API
6. Browser shows class details, user confirms
7. Realtime subscription on `class_states` table streams updates

**Cron → Queue → Email Flow (Every 30 Minutes):**

1. **Cron Trigger** (Cloudflare scheduled event, e.g., "0,30 * * * *")
   - Calls `worker.ts::scheduled()` handler
   - Makes internal HTTP GET to `/api/cron` with `CRON_SECRET` Bearer token

2. **Cron Route** (`app/api/cron/route.ts`)
   - Authenticates via timing-safe Bearer token comparison
   - Acquires distributed lock via `CronLockDO` (prevents concurrent runs)
   - Queries `getSectionsToCheck(staggerType)` → RPC to PostgreSQL
   - Stagger type based on current minute: even (0,2,4,6,8) at :00, odd (1,3,5,7,9) at :30
   - Enqueues messages to `CLASS_CHECK_QUEUE` (Cloudflare Queue)
   - Returns lock release response

3. **Queue Consumer** (`worker.ts::queue()` handler)
   - Cloudflare delivers batches of up to 5 messages
   - For each message: makes internal HTTP POST to `/api/queue/process-section`
   - Concurrent invocations up to 20 (config: `max_concurrency` in wrangler.jsonc)

4. **Section Processor** (`app/api/queue/process-section/route.ts`)
   - Authenticates via `CRON_SECRET` Bearer token
   - Fetches OLD state from `class_states` table
   - Fetches NEW data from ASU API via `fetchClassFromASU()`
   - Compares: seats_available, instructor_name, etc.
   - If changed: calls `tryRecordNotificationsBatch()` (atomic check-insert)
   - If atomic insert succeeds: triggers `sendBatchEmailsOptimized()` (Resend batch API)
   - Updates `class_states` row with new data
   - Returns 200 (queue acks) or 500 (queue retries up to 3x)

5. **Email Sending** (`lib/email/resend.ts`)
   - Batches emails into chunks of 100 (Resend limit)
   - Generates unsubscribe token for each recipient
   - Renders template HTML (seat_available or instructor_assigned)
   - Sends via Resend batch API (single request for 50 emails ≈ 0.5s)

**State Management:**
- **Browser state** - React hooks (useState, useContext), ephemeral
- **Database state** - Source of truth for watches, class states, notifications
- **RLS enforcement** - Middleware injects `userId` into session, database filters queries
- **Real-time state** - Supabase broadcasts `class_states` changes via WebSocket to subscribed clients

## Key Abstractions

**Class Watch (Domain Entity):**
- Purpose: Represents user's interest in a class section
- Files: Database table in `supabase/migrations/`, model in `lib/supabase/database.types.ts`
- Pattern: One row per user+class+term, soft-unique constraint (no delete, just mark inactive)
- Example: User 123 watching section "12431" for term "2261"

**Class State (Cached Snapshot):**
- Purpose: Latest known state of a section (seats, instructor, meeting times)
- Files: Cached in `class_states` table, fetched fresh from ASU API per cycle
- Pattern: Upsert on every queue processor run (atomic insert-or-update)
- Usage: Change detection (compare old state to new state), UI display via Realtime

**Notification Record (Deduplication Token):**
- Purpose: Tracks whether notification already sent for a (watch, type) pair
- Files: `notifications_sent` table with unique(class_watch_id, notification_type)
- Pattern: Atomic insert via PostgreSQL function `tryRecordNotifications()`, race-condition safe
- Flow: Check if record exists → if not, insert and send email → if insert fails, skip email

**Cron Lock (Distributed Coordination):**
- Purpose: Prevents concurrent cron executions across multiple Worker isolates
- Files: `CronLockDO` Durable Object in `worker.ts`
- Pattern: Single instance per job name, auto-expires after 25 minutes
- Usage: Cron acquires lock, processes, releases lock (or auto-expires on crash)

**Message Queue Batch (Async Work Unit):**
- Purpose: Batches section checks for parallel processing
- Files: Message type in `lib/types/queue.ts`, batch handler in `worker.ts::queue()`
- Pattern: Enqueue → batch → concurrent processing (max 20 concurrent, 5 per batch)
- Retry: 3 automatic retries (60s delay), then dead-letter queue

## Entry Points

**Landing Page:**
- Location: `app/page.tsx`
- Triggers: Browser navigates to `/`
- Responsibilities: Marketing site, SEO metadata, social proof, call-to-action to register

**Dashboard (Authenticated User):**
- Location: `app/dashboard/page.tsx`
- Triggers: Authenticated user navigates to `/dashboard`
- Responsibilities: List watched classes, show real-time seat availability, provide add/remove UI

**Admin Dashboard:**
- Location: `app/admin/page.tsx`
- Triggers: Admin user (is_admin=true) navigates to `/admin`
- Responsibilities: View all users, view all class watches, manual class inspection

**Cron Job (Every 30 Min):**
- Location: `app/api/cron/route.ts`
- Triggers: Cloudflare Worker scheduled handler at 0 and 30 minutes of every hour
- Responsibilities: Acquire lock, fetch staggered sections, enqueue messages to queue

**Queue Processor (Parallel):**
- Location: `app/api/queue/process-section/route.ts`
- Triggers: Each message from CLASS_CHECK_QUEUE (batch of up to 5)
- Responsibilities: Fetch ASU data, detect changes, atomically record notifications, send emails

**Health Check (Monitoring):**
- Location: `app/api/monitoring/health/route.ts`
- Triggers: External monitor polling every 60s
- Responsibilities: Check database connectivity, circuit breaker status, email service status

## Error Handling

**Strategy:** Fail-safe with explicit retry boundaries and dead-letter queues

**Patterns:**

- **Auth Errors (401):** Non-retryable. Invalid credentials, missing secrets → log, alert
  - ASU API: `AuthError` → cron marks section as non-retryable, moves to DLQ after 1 attempt
  - Cron secret: `timingSafeCompare()` prevents timing attacks

- **Not Found (404):** Non-retryable. Class deleted from ASU → log as informational
  - Returns 200 so queue acks message (don't retry deleted classes)

- **Rate Limit (429):** Retryable (exponential backoff). ASU API throttling
  - Queue retries up to 3x with 60s delay between attempts
  - If all retries exhausted → move to `class-check-dlq` dead-letter queue

- **Database Errors:** Retryable. Connection timeouts, constraint violations
  - Notification dedup: If atomic insert fails (duplicate), skip email send
  - State update: If upsert fails, next cycle will retry

- **Email Errors:** Retryable. Resend API errors
  - Catches error, logs, rolls back notification records (delete from `notifications_sent`)
  - Queue message retries, next attempt will re-record and re-send

- **Durable Object Lock Timeout:** Auto-expires after 25 minutes (safety valve)
  - If cron crashes holding lock, next run auto-acquires after 25m
  - 5-minute buffer before next 30-minute cron window

## Cross-Cutting Concerns

**Logging:**
- Approach: console.log with prefix (e.g., "[Cron]", "[Queue-Processor]", "[DB]")
- Deployment: Logs aggregated in Cloudflare Workers dashboard + tail via `wrangler tail`
- Sensitive data: Never log auth tokens, user emails in plaintext, API responses with PII

**Validation:**
- Auth: Middleware uses `getUser()` + RLS policies
- User input: Zod schemas on API routes (`app/api/auth/register/route.ts` uses zod for email validation)
- Class numbers: ASU API validation on fetch (404 if not found)

**Authentication:**
- Browser sessions: Supabase session cookies + JWT tokens (HTTP-only)
- Service operations: `CRON_SECRET` Bearer token (timing-safe comparison)
- Admin routes: Check `user_profiles.is_admin` in middleware, redirect non-admins

**Request Tracing:**
- Correlation: Internal HTTP requests include User-Agent header for debugging
- Cron: Logs lock holder ID and duration
- Queue: Logs batch size, individual message duration, success/failure count

**Type Safety:**
- Two tsconfig files: `tsconfig.json` (app) and `tsconfig.worker.json` (worker.ts)
- Both must pass `tsc --noEmit` in CI
- Durable Objects: Extend `DurableObject<Cloudflare.Env>`, not local interface

**Security Headers:**
- Middleware applies CSP, X-Frame-Options, X-Content-Type-Options
- PRODUCTION_CSP: Strict (no unsafe-inline script, only defined domains)
- DEV_CSP: Relaxed (allows unsafe-eval for hot reload)

---

*Architecture analysis: 2026-02-26*
