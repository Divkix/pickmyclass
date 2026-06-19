# PickMyClass

<img width="1440" height="900" alt="PickMyClass - free ASU class seat tracker with open-seat email alerts" src=".github/screenshot.png" />


A high-performance, scalable class seat notification system for university students. Monitor class availability, get notified when seats open up, and track instructor assignments.

Built with vinext (Vite-based Next.js), Supabase, and deployed on Cloudflare Workers for edge performance.

## Features

- **Seat Monitoring** - Track when seats become available in full classes
- **Instructor Tracking** - Get notified when "Staff" instructors are assigned to specific professors
- **Real-time Updates** - Dashboard updates live via Supabase Realtime subscriptions
- **Email Notifications** - Instant email alerts via Cloudflare Email Service when changes are detected
- **Smart Deduplication** - Prevents duplicate notifications using atomic PostgreSQL operations
- **Scalable Queue Processing** - Handles 10,000+ users with parallel Cloudflare Queues
- **30-Minute Checks** - Automated checks via Cloudflare Workers Cron Triggers

## Why Cloudflare Workers?

We chose Cloudflare Workers as our deployment platform for several compelling reasons:

### Edge-First Architecture
- **Global Distribution**: Code runs in 300+ data centers worldwide, ensuring low latency for all users
- **No Cold Starts**: Workers are always warm, providing consistent sub-100ms response times
- **Smart Placement**: Automatic routing to the nearest data center

### Cost Efficiency
- **Generous Free Tier**: 100,000 requests/day free, more than enough for most deployments
- **Pay-Per-Use**: Only pay for actual compute time, not idle servers
- **No Infrastructure Management**: Zero DevOps overhead

### Native Primitives for Scalability
- **Cloudflare Queues**: Reliable message queue for processing class checks at scale
- **Durable Objects**: Distributed coordination for cron locks (CronLockDO) and future coordination features
- **Workers KV**: Edge caching for fast data retrieval
- **Supabase over HTTP**: Database and auth accessed via `@supabase/supabase-js` over HTTP (no Hyperdrive binding)

### Reliability
- **Automatic Failover**: Built-in redundancy across data centers
- **DDoS Protection**: Enterprise-grade security by default
- **99.99% Uptime SLA**: Production-grade reliability

### Developer Experience
- **vinext Compatibility**: Deploy apps on Cloudflare Workers via Vite-based build
- **Instant Deployments**: Sub-second deployments via Wrangler CLI
- **Integrated Monitoring**: Real-time logs and analytics

## Architecture

```
User Browser
      |
      v
vinext App (Cloudflare Workers) <---> Supabase (Auth + PostgreSQL + Realtime)
      |
      v
Cloudflare Cron (every 30 min + daily at 4 AM)
      |
      v
CronLockDO (Durable Object) - prevents duplicate executions
      |
      v
Cloudflare Queue (pickmyclass-queue)
      |
      v
Queue Consumers (20 concurrent Workers)
      |
      v
worker.ts -> internal HTTP -> app/api/queue/process-section/route.ts
      |
      v
ASU Class Search API (direct HTTP calls)
      |
      v
Change Detection --> Cloudflare Email Service --> User Notifications
```

### Key Components

| Component | Purpose |
|-----------|---------|
| `worker.ts` | Custom Cloudflare Worker with cron, queue handlers, and Durable Objects |
| `app/api/cron/route.ts` | Cron job entry point - enqueues sections to queue |
| `app/api/queue/process-section/route.ts` | Queue consumer - processes single section |
| `lib/db/queries.ts` | Database query helpers with atomic deduplication |
| `lib/asu/api.ts` | ASU Class Search API client (direct HTTP) |
| `lib/queue/process-section.ts` | Section processing orchestrator |
| `lib/queue/dlq-consumer.ts` | Dead Letter Queue consumer |
| `lib/queue/change-detector.ts` | Change detection logic |
| `lib/queue/notification-sender.ts` | Notification sending with atomic deduplication |
| `lib/email/send.ts` | Cloudflare Email Service batch sender |
| `lib/cache/ttl-cache.ts` | TTL cache for ASU API responses |
| `lib/api/schemas.ts` | Queue message validation schemas |
| `middleware.ts` | Next.js middleware (auth, routing) |
| `proxy.ts` | Proxy configuration |
| `lib/auth/lockout.ts` | Brute-force lockout protection |
| `lib/auth/disposable-email.ts` | Disposable email validation |

### API Routes

| Route | Methods | Description |
|-------|---------|-------------|
| `app/api/auth/check-lockout/route.ts` | POST | Check account lockout status |
| `app/api/auth/login/route.ts` | POST | User login with lockout protection |
| `app/api/auth/register/route.ts` | POST | User registration with disposable email blocking |
| `app/api/auth/send-email-hook/route.ts` | POST | Supabase auth email hook (custom email sending) |
| `app/api/auth/signout/route.ts` | POST | Sign out and invalidate session |
| `app/api/class-watches/route.ts` | GET, POST, DELETE | Create, read, and delete class watches (no update) |
| `app/api/cron/route.ts` | GET | Cron job entry - enqueues sections with staggered groups and Durable Object lock |
| `app/api/cron/update-disposable-domains/route.ts` | GET | Daily sync of disposable email domain blocklist |
| `app/api/fetch-class-details/route.ts` | POST | Fetch class details from ASU API and persist state |
| `app/api/monitoring/health/route.ts` | GET | System health check (DB, ASU API, Cron Lock, email, config) |
| `app/api/queue/process-section/route.ts` | POST | Queue consumer adapter - processes single section via internal HTTP from worker.ts |
| `app/api/unsubscribe/route.ts` | GET, POST | CAN-SPAM/RFC 8058 compliant email unsubscribe |
| `app/api/user/delete/route.ts` | DELETE | Soft-delete account (CCPA compliance, 30-day retention) |
| `app/api/user/export/route.ts` | GET | Export all user data in JSON (CCPA compliance) |

### Durable Objects

**CronLockDO** - Prevents duplicate cron executions
- Auto-expires after 25 minutes
- Ensures only one cron job runs at a time across all isolates

## Self-Hosting Guide

### Prerequisites

- [Bun](https://bun.sh/) (package manager)
- [Supabase Account](https://supabase.com/) (free tier available)
- [Cloudflare Account](https://cloudflare.com/) (free tier available)
- ASU API access (configured via `ASU_API_BASE_URL` and `ASU_API_TOKEN`)

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/pickmyclass.git
cd pickmyclass
bun install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Link your local project:
   ```bash
   bunx supabase link --project-ref your-project-id
   ```
3. Push database migrations:
   ```bash
   bunx supabase db push
   ```
4. Generate TypeScript types:
   ```bash
   bunx supabase gen types typescript --project-id osopxwuebsefhoxgeojh > lib/supabase/database.types.ts
   ```

### 3. Configure Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Required variables:

| Variable | Description | Where to Get It |
|----------|-------------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | Supabase Dashboard -> Settings -> API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | Supabase Dashboard -> Settings -> API |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypasses RLS) | Supabase Dashboard -> Settings -> API |
| `ASU_API_BASE_URL` | Base URL for ASU Class Search API | ASU API endpoint |
| `ASU_API_TOKEN` | Auth token for ASU API | Obtained from ASU (external API credential) |
| `CRON_SECRET` | Auth for cron endpoint | Generate: `openssl rand -hex 32` |
| `NOTIFICATION_FROM_EMAIL` | Sender address for email notifications | A Cloudflare Email Service-enabled sender address |
| `SUPABASE_SEND_EMAIL_HOOK_SECRET` | Secret for Supabase auth email hook | Supabase Dashboard -> Authentication -> Hooks -> Send Email |
| `UNSUBSCRIBE_SIGNING_SECRET` | Signs unsubscribe tokens (CAN-SPAM) | Generate: `openssl rand -hex 32` |

### 4. Update Cloudflare Configuration

Edit `wrangler.jsonc` and update the placeholder values:

```jsonc
{
  "vars": {
    "NOTIFICATION_FROM_EMAIL": "notifications@your-domain.com",
    "NEXT_PUBLIC_SITE_URL": "https://your-domain.com",
    "NEXT_PUBLIC_SUPABASE_URL": "https://your-project-id.supabase.co"
  }
}
```

> **Note:** `ASU_API_BASE_URL` and `ASU_API_TOKEN` are configured as Cloudflare encrypted secrets (not vars) to avoid exposing the API endpoint in source code. Set them via `wrangler secret put` (see step 5 below).
```

Optionally configure a custom domain:

```jsonc
{
  "routes": [
    {
      "pattern": "your-domain.com",
      "custom_domain": true
    }
  ]
}
```

### 5. Set Cloudflare Secrets

```bash
# Authenticate with Cloudflare
wrangler login

# Set secrets (you'll be prompted for values)
wrangler secret put NEXT_PUBLIC_SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put ASU_API_BASE_URL
wrangler secret put ASU_API_TOKEN
wrangler secret put CRON_SECRET
wrangler secret put SUPABASE_SEND_EMAIL_HOOK_SECRET
wrangler secret put UNSUBSCRIBE_SIGNING_SECRET
```

### 6. Deploy

```bash
bun run deploy
```

Your app will be live at `https://your-worker.workers.dev` or your custom domain.

### 7. Set Up Cloudflare Queues

Verify queues exist in Cloudflare Dashboard:

1. Go to Workers & Pages -> Queues
2. Confirm `pickmyclass-queue` and `pickmyclass-dlq` are present (created automatically by `wrangler deploy`)

### 8. Customize Legal Pages (Optional)

The `app/legal/` directory contains Terms of Service and Privacy Policy pages with ASU-specific content and hardcoded email addresses (`support@pickmyclass.app`). For your deployment:

- Update contact email addresses in:
  - `app/legal/page.tsx`
  - `app/legal/terms/page.tsx`
  - `app/legal/privacy/page.tsx`
- Review and customize legal content for your institution/jurisdiction
- Update the privacy policy to reflect your data practices

### 9. Verify Deployment

- Check the health endpoint: `https://your-domain.com/api/monitoring/health`
- Verify cron triggers in Cloudflare Dashboard -> Workers -> Triggers
- Test by adding a class watch in the dashboard

## Development

### Local Development

```bash
bun run dev              # Start dev server (localhost:3000)
```

### Preview with Cloudflare

```bash
bun run preview          # Build with vinext and preview locally
```

### Other Commands

```bash
bun run build            # Build application
bun run lint             # Run Oxlint linter
bun run lint:fix         # Fix lint issues
bun run format           # Format code with Oxfmt
bun run knip             # Find unused exports/dependencies
bun run cf-typegen       # Generate TypeScript types for Cloudflare env
```

### Database Commands

```bash
bunx supabase db push                # Push migrations to remote
bunx supabase db pull                # Pull remote schema changes
bunx supabase migration new <name>   # Create new migration
```

## Tech Stack

- **Frontend**: vinext (App Router), React 19, TypeScript, Tailwind CSS 4
- **Backend**: Cloudflare Workers (via vinext), Supabase (PostgreSQL + Auth + Realtime)
- **Data Source**: ASU Class Search API (direct HTTP)
- **Email**: Cloudflare Email Service (transactional emails)
- **Deployment**: Cloudflare Workers + Pages

## Project Structure

```
app/                         # App Router
  ├── about/                 # About page
  ├── api/                   # API endpoints (14 routes)
  ├── auth/callback/         # OAuth callback
  ├── admin/                 # Admin panel (users, classes, dashboard)
  ├── blog/                  # Blog pages (6 posts + RSS feed)
  ├── dashboard/             # Main dashboard with Realtime updates
  ├── dashboard/add/         # Add class watch page
  ├── faq/                   # FAQ page
  ├── forgot-password/       # Forgot password flow
  ├── go/[uni]/              # University redirect links
  ├── legal/                 # Legal pages (terms, privacy)
  ├── login/                 # Login page
  ├── register/              # Registration page
  ├── reset-password/        # Reset password flow
  ├── settings/              # User settings
  ├── verify-email/          # Email verification
  ├── layout.tsx             # Root layout
  └── page.tsx               # Landing page

lib/
  ├── api/                   # API schemas and validation
  ├── asu/                   # ASU Class Search API client
  ├── auth/                  # Authentication utilities (lockout, disposable email, admin)
  ├── blog/                  # Blog posts data
  ├── cache/                 # TTL cache utilities
  ├── contexts/              # React contexts (Auth, Theme)
  ├── db/                    # Database query helpers
  ├── email/                 # Email templates + Cloudflare Email Service
  ├── hooks/                 # React hooks (Realtime, pull-to-refresh, swipe)
  ├── queue/                 # Queue processing (change detection, notification sending, DLQ)
  ├── supabase/              # Supabase clients (browser, server, service)
  ├── types/                 # TypeScript type definitions (class, env, queue, watch)
  ├── utils/                 # Utility functions (crypto, rate-my-professor, seat badge, time format)
  └── utils.ts               # shadcn/ui utility (cn function)

components/
  ├── admin/                 # Admin panel components (tables, filters, sorting)
  ├── blog/                  # Blog components (TOC, author, FAQ, comparison)
  ├── landing/               # Landing page components (hero, features, how it works, CTA)
  ├── ui/                    # shadcn/ui components
  └── ...                    # Feature components (header, footer, watch cards, dialogs)

supabase/
  └── migrations/            # Database migrations

worker.ts                    # Custom Cloudflare Worker
wrangler.jsonc               # Cloudflare Workers config
```

> **Note:** `lib/utils.ts` is the shadcn/ui utility file (contains the `cn` function), while `lib/utils/` is a directory for custom utility functions (crypto, formatting, seat badge helpers). Both coexist by design.

## How It Works

1. **User adds class watch** - Student enters section number on dashboard
2. **Every 30 minutes** - Cloudflare cron triggers enqueue all watched sections
3. **Queue consumers process** - 20 concurrent Workers query ASU API in parallel
4. **Change detection** - Compare new state with PostgreSQL cached state
5. **Atomic deduplication** - PostgreSQL `INSERT...ON CONFLICT` prevents race conditions
6. **Email notification** - Cloudflare Email Service sends alerts for available seats
7. **Real-time update** - Dashboard reflects changes via Supabase Realtime

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Quick Start for Contributors

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run linting: `bun run lint:fix`
5. Commit with conventional commits: `git commit -m "feat: add new feature"`
6. Push and open a PR

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [vinext](https://github.com/cloudflare/vinext) - Vite-based Next.js reimplementation for Cloudflare Workers
- [Supabase](https://supabase.com/) - Open source Firebase alternative
- [Cloudflare Email Service](https://developers.cloudflare.com/email/) - Email sending from Workers
- [shadcn/ui](https://ui.shadcn.com/) - UI component library
