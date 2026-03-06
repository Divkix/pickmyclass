# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PickMyClass is a class seat notification system for university students. Built with vinext (Vite-based Next.js reimplementation), React 19, Tailwind CSS 4, and deployed on Cloudflare Workers. Auth and database via Supabase (PostgreSQL with RLS). UI components from shadcn/ui.

**Core Flow:**
1. Students add class sections to monitor by section number
2. Cloudflare Workers Cron Triggers run every 30 minutes
3. Queue consumers (up to 20 concurrent, batches of 5) query ASU Class Search API
4. Detects seat availability changes or instructor assignments
5. Sends email notifications via Resend batch API
6. Dashboard updates live via Supabase Realtime subscriptions

## Key Commands

### Development
```bash
bun run dev              # Start dev server (localhost:3000)
bun run build            # Build application
bun run lint             # Run Biome linter (biome check .)
bun run lint:fix         # Fix lint issues
bun run format           # Format code with Biome
bun run knip             # Find unused exports/dependencies
```

### Testing
```bash
bun run test             # Run vitest in watch mode
bun run test:run         # Run tests once (CI mode)
bun run test:coverage    # Run tests with V8 coverage (80% threshold)
bun run test:ui          # Run vitest with browser UI
```

Tests live in `tests/` directory (not colocated). Run a single test file:
```bash
bunx vitest run tests/unit/lib/utils.test.ts
```

### Cloudflare Workers
```bash
bun run preview          # Build with vinext and preview locally
bun run deploy           # Build and deploy (includes wrangler triggers deploy)
bun run cf-typegen       # Generate TypeScript types for Cloudflare env bindings
rm -rf .next dist && bun run preview    # Clean build
```

### Database (Supabase)
```bash
bunx supabase db push                        # Push migrations to remote
bunx supabase db pull                        # Pull remote schema changes
bunx supabase migration new <name>           # Create new migration
bunx supabase gen types typescript --linked > lib/supabase/database.types.ts  # Generate types
```

### CI Pipeline (`.github/workflows/ci.yml`)

CI runs three parallel jobs on push/PR to main:
1. **quality** - `biome ci .` (standalone, no bun install needed)
2. **test** - `bun run test:coverage` (80% branch/function/line/statement thresholds)
3. **check** - TypeScript typecheck (main + worker tsconfig), knip, build

Both main `tsconfig.json` and `tsconfig.worker.json` must pass `tsc --noEmit`.

## Architecture

### Request Flow
```
User Browser -> vinext (Cloudflare Workers) -> Supabase (Auth + PostgreSQL + Realtime)
                                                 |
Cron (every 30 min) -> Cloudflare Queue -> Queue Consumers (max_concurrency: 20)
                                                 |
                       ASU Class Search API (direct HTTP calls)
                                                 |
                       Change Detection -> Resend Email API -> User Notifications
```

### How worker.ts Connects Everything

`worker.ts` is the Cloudflare Worker entrypoint. It wraps vinext's app-router-entry handler and adds:
- **`fetch`** - Delegates to vinext app
- **`scheduled`** - Cron handler makes internal HTTP request to `/api/cron` with `CRON_SECRET` auth
- **`queue`** - Queue consumer processes batches, each message makes internal HTTP POST to `/api/queue/process-section`
- **Durable Objects** - `CronLockDO` for distributed cron locking

The cron and queue handlers route through the vinext app via internal HTTP calls so environment bindings (Supabase, ASU API, etc.) are available via `import { env } from 'cloudflare:workers'`.

### Key Components

| Location | Purpose |
|----------|---------|
| `worker.ts` | Custom Cloudflare Worker with cron, queue handlers, and Durable Objects |
| `app/api/cron/route.ts` | Cron job entry point - enqueues sections to queue |
| `app/api/queue/process-section/route.ts` | Queue consumer - processes single section |
| `lib/db/queries.ts` | Database query helpers (bulk operations, atomic deduplication) |
| `lib/db/admin-queries.ts` | Admin-specific database queries |
| `lib/supabase/service.ts` | Service role client (bypasses RLS) |
| `lib/email/resend.ts` | Resend email integration with batch API |
| `lib/queue/dlq-consumer.ts` | Dead letter queue handler - logging + admin alerts |
| `lib/email/unsubscribe-token.ts` | Signed token generation for email unsubscribe links |
| `middleware.ts` | Auth middleware with CSP headers and role-based routing |
| `lib/asu/api.ts` | ASU Class Search API client (direct HTTP) |
| `lib/auth/lockout.ts` | Failed login attempt tracking and lockout |

### Middleware Routing Logic

`middleware.ts` handles auth, security headers, and routing in this order:
1. Public routes without auth cookies get CSP/security headers and pass through
2. All other routes create a Supabase client and call `getUser()`
3. Disabled accounts (`is_disabled`) are signed out and redirected to `/login?error=account_disabled`
4. Unverified emails are redirected to `/verify-email`
5. Unauthenticated users on protected routes go to `/login`
6. Authenticated users on auth pages (`/login`, `/register`, `/forgot-password`) redirect to dashboard/admin
7. Admin users accessing `/dashboard` redirect to `/admin`

Public routes: `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/legal`, `/auth/callback`, `/go`, `/api/auth/*`, `/api/cron`, `/api/queue/*`, `/api/webhooks/*`, `/api/monitoring/*`, `/api/unsubscribe`

### Database Schema

All tables use Row Level Security (RLS). Key tables:

- `class_watches` - User -> Section mappings (unique per user/term/section)
- `class_states` - Cached section state for change detection
- `notifications_sent` - Deduplication tracking (unique per watch/type)
- `user_profiles` - User metadata: `is_admin`, `is_disabled`, email preferences

**Atomic Notification Deduplication:**
```typescript
// Use this - race-condition safe
const shouldSend = await tryRecordNotification(watchId, 'seat_available');
if (shouldSend) await sendEmail(...);

// NOT this - deprecated, has race condition
const sent = await hasNotificationBeenSent(watchId, type); // bad
```

### Durable Objects (in `worker.ts`)

**CronLockDO** - Prevents duplicate cron executions. Auto-expires after 25 minutes. Ensures only one cron job runs at a time across all isolates.

## Critical Implementation Notes

### Cloudflare Workers Memory Model
- **Global variables are per-isolate**, not shared across Workers
- For coordinated state: use Durable Objects
- For concurrent operations: use PostgreSQL functions with `INSERT...ON CONFLICT`

### TypeScript
- `Response.json()` returns `unknown` - always use type assertions
- Durable Objects: extend `DurableObject<Cloudflare.Env>`, not local `Env` interface
- Two tsconfigs: `tsconfig.json` (app) and `tsconfig.worker.json` (worker.ts)

### Queue Configuration (`wrangler.jsonc`)
- `max_batch_size: 5` - Messages per batch
- `max_batch_timeout: 10` - Seconds to wait for batch fill
- `max_concurrency: 20` - Concurrent consumer invocations
- `max_retries: 3` - Retries before dead letter queue (`pickmyclass-dlq`)
- `retry_delay: 60` - Seconds between retries
- DLQ consumer (`pickmyclass-dlq`): `max_batch_size: 1`, `max_retries: 0` — logs errors and sends admin alert emails, always acks

### Supabase Client Pattern
Three clients for different contexts:
- `lib/supabase/client.ts` - Browser client (anon key, respects RLS)
- `lib/supabase/server.ts` - Server component/route handler client (cookie-based auth)
- `lib/supabase/service.ts` - Service role client (bypasses RLS, for cron/queue workers)

All use placeholder values when env vars are missing during build.

## Environment Variables

**Cloudflare secrets (set via `wrangler secret put`):**
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` - Bypasses RLS for service operations
- `ASU_API_BASE_URL`, `ASU_API_TOKEN` - ASU Class Search API authentication
- `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` - Email service
- `CRON_SECRET` - Authenticates internal cron/queue requests

**Cloudflare vars (in `wrangler.jsonc`):**
- `NOTIFICATION_FROM_EMAIL`, `NEXT_PUBLIC_SITE_URL`, `MAX_WATCHES_PER_USER`

## Admin System

Admins are flagged via `user_profiles.is_admin` boolean. Middleware redirects admin users from `/dashboard` to `/admin`.

**Promote user to admin:**
```sql
UPDATE user_profiles
SET is_admin = true
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'user@example.com');
```

User must log out and back in for admin status to take effect.

## Common Issues

**Build fails with missing Supabase credentials**
- Ensure placeholder logic in `lib/supabase/client.ts` and `lib/supabase/server.ts` is intact

**Cloudflare Workers compatibility**
- Test new dependencies with `bun run preview` before deploying
- Uses `nodejs_compat` and `global_fetch_strictly_public` compatibility flags

**Cron triggers not deploying**
- `bun run deploy` includes `wrangler triggers deploy` automatically
- Verify in Cloudflare Dashboard -> Workers -> Triggers

## Monitoring

- **Health endpoint:** `GET /api/monitoring/health` - DB, circuit breaker, email service status
- **Queue metrics:** Cloudflare Dashboard -> Queues -> pickmyclass-queue
- **Observability:** Enabled in wrangler.jsonc with full log persistence
