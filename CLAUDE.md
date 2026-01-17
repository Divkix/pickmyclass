# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PickMyClass is a class seat notification system for university students. Built with Next.js 15.5, Supabase authentication, and deployed via Docker containers.

**Core Flow:**
1. Students add class sections to monitor by section number
2. Node-cron scheduler runs every 30 minutes (staggered by even/odd section numbers)
3. BullMQ workers (4 concurrent) process sections via Puppeteer scraper service
4. Detects seat availability changes or instructor assignments
5. Sends email notifications via Resend batch API

**Scalability:** Designed for 10,000+ users with BullMQ queue processing, Redis-based circuit breaker and distributed locks, atomic PostgreSQL operations for deduplication.

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

### Production (VPS)
```bash
bun run start:prod       # Start production server (Next.js + cron + workers)
```

### Docker (Production)
```bash
# Build and run (local dev with Redis)
docker compose up --build

# Production (Upstash Redis)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# View logs
docker compose logs -f app

# Rebuild after changes
docker compose build app && docker compose up -d app

# Health check
curl http://localhost:3000/api/monitoring/health
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
User Browser --> Next.js (Docker) --> Supabase (Auth + PostgreSQL + Realtime)
                                              |
node-cron (every 30 min) --> BullMQ Queue --> Queue Workers (4 concurrent)
                                              |
                      Scraper Service (Oracle Cloud + Puppeteer) --> ASU Class Search
                                              |
                      Change Detection --> Resend Email API --> User Notifications
```

### Infrastructure Stack
```
VPS (Oracle Cloud A1)
├── Docker - Container runtime
├── Next.js - Web application (server.ts entry point)
├── BullMQ - Job queue processing
└── node-cron - Scheduled task runner

External Services
├── Upstash Redis - Queue backend, circuit breaker, distributed locks
├── Supabase - PostgreSQL database, authentication
├── Resend - Email delivery
└── Scraper Service - Puppeteer on Oracle Cloud
```

### Key Components

| Location | Purpose |
|----------|---------|
| `server.ts` | Unified entry point - starts Next.js, cron scheduler, queue workers |
| `lib/redis/client.ts` | Redis client singleton (Upstash/local support) |
| `lib/redis/circuit-breaker.ts` | Redis-based circuit breaker for scraper fault tolerance |
| `lib/redis/cron-lock.ts` | Distributed lock for cron job deduplication |
| `lib/queue/queues.ts` | BullMQ queue definitions and enqueue helpers |
| `lib/queue/worker.ts` | BullMQ worker - processes class check jobs |
| `lib/queue/config.ts` | Queue configuration (concurrency, retries) |
| `lib/cron/scheduler.ts` | node-cron scheduler setup |
| `lib/cron/class-check.ts` | Cron job logic - fetches sections, enqueues to BullMQ |
| `app/api/cron/route.ts` | HTTP trigger for cron (manual or external scheduler) |
| `lib/db/queries.ts` | Database query helpers (bulk operations, atomic deduplication) |
| `lib/supabase/service.ts` | Service role client (bypasses RLS) |
| `lib/email/resend.ts` | Resend email integration with batch API |
| `middleware.ts` | Auth middleware with role-based routing (admin vs user) |
| `scraper/` | Standalone Puppeteer service on Oracle Cloud |
| `Dockerfile` | Docker container configuration |
| `docker-compose.yml` | Docker Compose for local development |
| `docker-compose.prod.yml` | Docker Compose production overrides |

### Circuit Breaker (Redis-based)

Distributed fault tolerance for scraper service:
- States: CLOSED (healthy) -> OPEN (blocking, 10 failures) -> HALF_OPEN (testing recovery)
- Stored as JSON in Redis key `circuit-breaker:scraper`
- Thresholds: 10 failures to open, 2-minute timeout, 3 successes to close

### Cron Lock (Redis-based)

Prevents duplicate cron executions across multiple processes:
- Uses Redis `SET NX PX` for atomic lock acquisition with 25-minute TTL
- Lua script for atomic conditional release
- Key: `cron-lock:class-check`

### Database Schema

All tables use Row Level Security (RLS). Key tables:

- `class_watches` - User -> Section mappings (unique per user/term/section)
- `class_states` - Cached section state for change detection
- `notifications_sent` - Deduplication tracking (unique per watch/type)
- `user_profiles` - User metadata including `is_admin` flag

**Atomic Notification Deduplication:**
```typescript
// Use this - race-condition safe
const shouldSend = await tryRecordNotification(watchId, 'seat_available');
if (shouldSend) await sendEmail(...);

// NOT this - deprecated, has race condition
const sent = await hasNotificationBeenSent(watchId, type); // X
```

## Critical Implementation Notes

### BullMQ Queue Configuration
- Concurrency: 4 workers process jobs in parallel
- Retries: 3 attempts with exponential backoff
- Job deduplication: Uses `${term}-${classNbr}` as job ID
- Dead letter queue for failed jobs after all retries

### node-cron v4.x Notes
- Schedule: `"0,30 * * * *"` (every 30 minutes at :00 and :30)
- Tasks need explicit `.start()` call after creation
- Callback receives `TaskContext`, not `(Date | "manual" | "init")`

### Graceful Shutdown
Server handles SIGTERM/SIGINT with ordered shutdown:
1. Stop accepting new HTTP requests
2. Stop cron scheduler
3. Wait for current queue jobs to complete (30s timeout)
4. Close queue connections
5. Close Redis connection

### Staggered Cron Strategy
- `:00` and `:30` runs process even class numbers (last digit: 0, 2, 4, 6, 8)
- This was the original design but currently both runs process all sections
- Staggering doubles effective capacity when enabled

## Environment Variables

**Required for production:**
- `REDIS_URL` - Upstash Redis URL (rediss://... for TLS)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` - Bypasses RLS for service operations
- `SCRAPER_URL`, `SCRAPER_SECRET_TOKEN` - Scraper service authentication
- `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` - Email service
- `CRON_SECRET` - Authenticates internal cron/queue requests

**Optional:**
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (production/development)

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

**Redis connection fails**
- Verify `REDIS_URL` is set correctly
- For Upstash, use `rediss://` protocol (TLS)
- For local Redis, use `redis://localhost:6379`

**Container not starting**
- Check Docker logs: `docker compose logs -f app`
- Verify environment variables in `.env` file

**Cron not running**
- Check container logs: `docker compose logs -f app`
- Verify scheduler started in server logs
- Manual trigger: `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron`

## Monitoring

- **Health endpoint:** `GET /api/monitoring/health` - Redis, queue stats, circuit breaker, cron lock status
- **Scraper status:** `GET <your-scraper-url>/status` - Browser pool metrics
- **Docker logs:** `docker compose logs -f app` - Real-time application logs
- **Queue metrics:** Via health endpoint (waiting, active, completed, failed counts)

## VPS Deployment Checklist

1. [ ] Provision Oracle Cloud A1 instance (1GB RAM, 1 OCPU)
2. [ ] Install Docker and Docker Compose
3. [ ] Clone repository
4. [ ] Configure `.env` with all required variables
5. [ ] Set up Upstash Redis (or local Redis)
6. [ ] Run `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`
7. [ ] Verify health endpoint: `curl http://localhost:3000/api/monitoring/health`
8. [ ] Configure reverse proxy (nginx/traefik) for HTTPS
9. [ ] Update DNS to point to VPS
10. [ ] Monitor for 24 hours
