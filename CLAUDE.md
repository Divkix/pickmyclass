# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PickMyClass is a class seat notification system for university students. Built with Next.js 15.5, Supabase authentication, and deployed on Cloudflare Workers via OpenNext.

**Core Flow:**
1. Students add class sections to monitor by section number
2. Cloudflare Workers Cron Triggers run every 30 minutes (staggered by even/odd section numbers)
3. Queue consumers (100+ concurrent Workers) scrape ASU class search via Puppeteer service
4. Detects seat availability changes or instructor assignments
5. Sends email notifications via Resend batch API

**Scalability:** Designed for 10,000+ users with parallel queue processing, atomic PostgreSQL operations for deduplication, and Durable Objects for distributed coordination.

## Key Commands

### Development
```bash
bun run dev              # Start Next.js dev server (localhost:3000)
bun run build            # Build Next.js application
bun run lint             # Run Biome linter
bun run lint:fix         # Fix lint issues
bun run format           # Format code with Biome
bun run knip             # Find unused exports/dependencies
```

### Cloudflare Workers
```bash
bun run preview          # Build with OpenNext and preview locally
bun run deploy           # Build and deploy (includes wrangler triggers deploy)
bun run cf-typegen       # Generate TypeScript types for Cloudflare env bindings
rm -rf .next .open-next && bun run preview    # Clean build
```

### Database (Supabase)
```bash
bunx supabase db push                        # Push migrations to remote
bunx supabase db pull                        # Pull remote schema changes
bunx supabase migration new <name>           # Create new migration
bunx supabase gen types typescript --linked > lib/supabase/database.types.ts  # Generate types
```

### Scraper Service (in `scraper/` directory)
```bash
bun run dev        # Start scraper in watch mode
bun run build      # Compile TypeScript
bun run start      # Run production build
bun run typecheck  # Type check without building
```

## Architecture

### Request Flow
```
User Browser → Next.js (Cloudflare Workers) → Supabase (Auth + PostgreSQL + Realtime)
                                              ↑
Cron (every 30 min) → Cloudflare Queue → Queue Consumers (100+ Workers)
                                              ↓
                      Scraper Service (Oracle Cloud + Puppeteer) → ASU Class Search
                                              ↓
                      Change Detection → Resend Email API → User Notifications
```

### Key Components

| Location | Purpose |
|----------|---------|
| `worker.ts` | Custom Cloudflare Worker with cron, queue handlers, and Durable Objects |
| `app/api/cron/route.ts` | Cron job entry point - enqueues sections to queue |
| `app/api/queue/process-section/route.ts` | Queue consumer - processes single section |
| `lib/db/queries.ts` | Database query helpers (bulk operations, atomic deduplication) |
| `lib/supabase/service.ts` | Service role client (bypasses RLS) |
| `lib/email/resend.ts` | Resend email integration with batch API |
| `middleware.ts` | Auth middleware with role-based routing (admin vs user) |
| `scraper/` | Standalone Puppeteer service on Oracle Cloud |

### Durable Objects (in `worker.ts`)

**CircuitBreakerDO** - Distributed fault tolerance for scraper
- States: CLOSED (healthy) → OPEN (blocking, 10 failures) → HALF_OPEN (testing recovery)
- Single instance coordinates all 100+ Worker isolates
- Access: `env.CIRCUIT_BREAKER_DO.get(env.CIRCUIT_BREAKER_DO.idFromName('scraper-circuit-breaker'))`

**CronLockDO** - Prevents duplicate cron executions
- Auto-expires after 25 minutes
- Ensures only one cron job runs at a time across all isolates

### Database Schema

All tables use Row Level Security (RLS). Key tables:

- `class_watches` - User → Section mappings (unique per user/term/section)
- `class_states` - Cached section state for change detection
- `notifications_sent` - Deduplication tracking (unique per watch/type)
- `user_profiles` - User metadata including `is_admin` flag

**Atomic Notification Deduplication:**
```typescript
// Use this - race-condition safe
const shouldSend = await tryRecordNotification(watchId, 'seat_available');
if (shouldSend) await sendEmail(...);

// NOT this - deprecated, has race condition
const sent = await hasNotificationBeenSent(watchId, type); // ❌
```

## Critical Implementation Notes

### Cloudflare Workers Memory Model
- **Global variables are per-isolate**, not shared across Workers
- For coordinated state (circuit breakers, rate limiters): use Durable Objects
- For concurrent operations: use PostgreSQL functions with `INSERT...ON CONFLICT`

### TypeScript Strict Mode Gotchas
- `Response.json()` returns `unknown` - always use type assertions: `as ScraperResponse`
- Durable Objects: extend `DurableObject<Cloudflare.Env>`, not local `Env` interface

### Queue Configuration (`wrangler.jsonc`)
- `max_batch_size: 5` - Messages per batch
- `max_batch_timeout: 30` - Max seconds to wait for batch (Cloudflare API limit)
- `max_retries: 3` - Retries before dead letter queue

### Staggered Cron Strategy
- `:00` and `:30` runs process even class numbers (last digit: 0, 2, 4, 6, 8)
- This was the original design but currently both runs process all sections
- Staggering doubles effective capacity when enabled

## Environment Variables

**Required (set as Cloudflare secrets):**
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` - Bypasses RLS for service operations
- `SCRAPER_URL`, `SCRAPER_SECRET_TOKEN` - Scraper service authentication
- `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` - Email service
- `CRON_SECRET` - Authenticates internal cron/queue requests

**Build Handling:** Supabase clients use placeholders when env vars unavailable during build. Scraper/email services gracefully skip operations when not configured.

## Admin System

Admins are flagged via `user_profiles.is_admin` boolean.

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
- Uses `nodejs_compat` flag for Node.js API support

**Cron triggers not deploying**
- `bun run deploy` includes `wrangler triggers deploy` automatically
- Verify in Cloudflare Dashboard → Workers → Triggers

## Monitoring

- **Health endpoint:** `GET /api/monitoring/health` - DB, circuit breaker, email service status
- **Scraper status:** `GET <your-scraper-url>/status` - Browser pool metrics
- **Queue metrics:** Cloudflare Dashboard → Queues → class-check-queue
