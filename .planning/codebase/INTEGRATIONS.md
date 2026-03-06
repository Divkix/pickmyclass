# External Integrations

**Analysis Date:** 2026-02-26

## APIs & External Services

**ASU Class Search API:**
- ASU Class Search Elasticsearch API - Queries class details by section number and term
  - SDK/Client: Custom HTTP client in `lib/asu/api.ts`
  - Auth: Bearer token (env var: `ASU_API_TOKEN`)
  - Endpoint: `ASU_API_BASE_URL` + `/search/classes` with query params `classNbr`, `term`
  - Response format: Elasticsearch response envelope with class details (enrollment, instructor, meeting times, facility)
  - Error handling: Custom error classes for AuthError (401/403), RateLimitError (429), NotFoundError (404), ApiError (generic)
  - Timeout: 10 second abort signal per fetch

**Resend Email API:**
- Email service for sending notifications - seat availability and instructor assignments
  - SDK/Client: `resend` npm package (version 6.9.2)
  - Auth: API key (env var: `RESEND_API_KEY`)
  - Implementation: Batch API in `lib/email/resend.ts` - sends up to 100 emails per batch request
  - Features: Custom email templates, unsubscribe token generation, List-Unsubscribe headers
  - Fallback: Console warning if not configured (graceful degradation in preview)

**RateMyProfessor (implicit):**
- Referenced in `lib/utils/ratemyprofessor.ts` (implementation details not explored)
- Likely used to enrich instructor information in notifications

## Data Storage

**Databases:**
- PostgreSQL 13+ (via Supabase)
  - Connection: `NEXT_PUBLIC_SUPABASE_URL` (public URL)
  - Authentication: Two-tier system:
    - **Anonymous client:** Uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` for user-facing operations (respects Row Level Security)
    - **Service role client:** Uses `SUPABASE_SERVICE_ROLE_KEY` for cron/queue workers (bypasses RLS)
  - Clients:
    - `lib/supabase/client.ts` - Browser client (createBrowserClient from @supabase/ssr)
    - `lib/supabase/server.ts` - Server component/route handler client (cookie-based auth via createServerClient)
    - `lib/supabase/service.ts` - Service role client for workers (no session management)
  - Key tables: `class_watches`, `class_states`, `notifications_sent`, `user_profiles`
  - Schema: Generated types in `lib/supabase/database.types.ts`
  - Migrations: Managed via `supabase` CLI in `supabase/migrations/` directory

**File Storage:**
- Local filesystem only - No cloud storage service integrated
- Assets served from Cloudflare Workers static file serving

**Caching:**
- Cloudflare KV Namespace (DISPOSABLE_DOMAINS_KV)
  - Binding: `DISPOSABLE_DOMAINS_KV`
  - Purpose: Cache disposable email domain list (updated daily at 4 AM UTC)
  - ID: `5b1c731cca674372be70d72be05acb7b` (Cloudflare namespace ID)

## Authentication & Identity

**Auth Provider:**
- Supabase (PostgreSQL built-in auth)
  - Implementation: Supabase Auth module (JWT-based)
  - Session storage: Browser cookies (httpOnly, secure)
  - Flows: Email/password signup, login, password reset, magic link (via Supabase)
  - Callback: `/auth/callback` route handles OAuth/email confirmation redirects
  - Admin promotion: Via `user_profiles.is_admin` boolean (requires logout/login to apply)
  - Account disable: Via `user_profiles.is_disabled` boolean (middleware redirects to login with error)
  - Email verification: Required before dashboard access (redirects unverified to `/verify-email`)

**Role-Based Access Control:**
- User roles: Regular user, Admin
- Implementation: `middleware.ts` checks `user_profiles.is_admin` and `user_profiles.is_disabled`
- Admin routes: `/admin` (regular users redirected from here to `/dashboard`)
- Protected routes: `/dashboard`, `/admin` (require auth)
- Public routes: `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/legal`, `/auth/callback`, `/go`, `/api/auth/*`, `/api/cron`, `/api/queue/*`, `/api/webhooks/*`, `/api/monitoring/*`, `/api/unsubscribe`

## Monitoring & Observability

**Error Tracking:**
- None detected - No Sentry, Rollbar, or similar error tracking service integrated

**Logs:**
- Cloudflare Workers observability enabled
  - Head sampling rate: 100% (1.0)
  - Log persistence: Enabled
  - Invocation logs: Enabled
  - Location: Cloudflare Dashboard -> Logs
- Console logging for debugging in routes and workers (e.g., `console.log('[Email]...', console.error('[Cron]...')`)

**Health Endpoint:**
- `GET /api/monitoring/health` - Reports database, circuit breaker, and email service status

## CI/CD & Deployment

**Hosting:**
- Cloudflare Workers (serverless platform)
- Edge deployment via vinext
- Custom domains support (commented config in `wrangler.jsonc`)

**Build Pipeline:**
- vinext - Vite-based Next.js reimplementation for Cloudflare Workers
- Wrangler - Official Cloudflare Workers CLI
- Build output: `dist/` directory with generated worker handler

**CI Workflow** (`.github/workflows/ci.yml`):
- **Quality job:** Biome standalone linter (no dependencies needed)
- **Test job:** Bun install + vitest with v8 coverage (80% thresholds)
- **Check job:** TypeScript typecheck (both tsconfig.json and tsconfig.worker.json), knip unused detection, build

**Deployment Commands:**
```bash
bun run preview                    # Build with vinext and test locally
bun run deploy                     # Build + deploy + trigger deployment
wrangler triggers deploy           # Deploy cron/queue triggers (included in deploy script)
```

## Environment Configuration

**Required env vars (via wrangler.jsonc vars section):**
- `NOTIFICATION_FROM_EMAIL` - Email address for notifications (default: "notifications@pickmyclass.app")
- `NEXT_PUBLIC_SITE_URL` - Frontend URL (default: "https://pickmyclass.app")
- `MAX_WATCHES_PER_USER` - Limit watches per user (default: "10")

**Required secrets (via `wrangler secret put` or Dashboard):**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL (public, can be in code)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Anonymous key (public, hardcoded in client.ts/server.ts)
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for workers (secret, must be set in production)
- `ASU_API_BASE_URL` - ASU API base URL (e.g., https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes)
- `ASU_API_TOKEN` - Bearer token for ASU API
- `RESEND_API_KEY` - Resend email service API key
- `RESEND_WEBHOOK_SECRET` - Webhook validation secret for Resend
- `CRON_SECRET` - Random secret for internal cron/queue authentication (generate with `openssl rand -hex 32`)

**Secrets location:**
- Development: Set locally via `wrangler secret put` or environment
- Production: Cloudflare Dashboard -> Settings -> Environment Variables (for vars) and Secrets (for secret keys)

## Webhooks & Callbacks

**Incoming:**
- `GET /api/auth/callback` - OAuth/email confirmation callback from Supabase
- `POST /api/webhooks/*` - Resend webhook endpoint (path not specified, but webhook secret configured)
- `POST /api/unsubscribe` - Email unsubscribe handler (processes signed tokens)
- `POST /api/cron` - Internal endpoint called by worker.ts scheduled handler (requires CRON_SECRET)
- `POST /api/queue/process-section` - Internal endpoint called by queue consumer (requires CRON_SECRET)

**Outgoing:**
- **To ASU API:** Direct HTTP GET requests from `lib/asu/api.ts` fetchClassFromASU()
- **To Resend:** Batch email requests from `lib/email/resend.ts` sendBatchEmailsOptimized()
- **To Supabase:** HTTPS API calls for auth, queries, subscriptions via @supabase/supabase-js
- **To user:** Email notifications via Resend (seat availability, instructor assignment events)

## Background Processing

**Cloudflare Workers Cron Triggers:**
- Schedule: `0,30 * * * *` (every 30 minutes at :00 and :30)
- Additional: `0 4 * * *` (daily at 4 AM UTC for disposable email domain list update)
- Handler: `worker.ts` scheduled() function → internal HTTP POST to `/api/cron`
- Locking: Durable Object (CronLockDO) prevents concurrent executions (25-minute timeout)
- Authentication: Bearer token (CRON_SECRET) required

**Cloudflare Queues (pickmyclass-queue):**
- Enqueued by: `/api/cron` route handler after locking
- Message type: `ClassCheckMessage` (see `lib/types/queue.ts`)
- Consumer config:
  - `max_batch_size`: 5 messages per batch
  - `max_batch_timeout`: 10 seconds to wait for batch fill
  - `max_concurrency`: 20 concurrent worker invocations
  - `max_retries`: 3 before dead letter queue
  - `retry_delay`: 60 seconds between retries
- Dead Letter Queue: `pickmyclass-dlq` (captures failed messages after 3 retries)
- Processor: Queue consumer Worker calls `/api/queue/process-section` (requires CRON_SECRET)
- Processing: Fetch class → detect seat/instructor changes → record notifications → send emails

---

*Integration audit: 2026-02-26*
