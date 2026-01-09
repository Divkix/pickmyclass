# PickMyClass

A high-performance, scalable class seat notification system for university students. Monitor class availability, get notified when seats open up, and track instructor assignments.

Built with Next.js 15, Supabase, and deployed on Cloudflare Workers for edge performance.

## Features

- **Seat Monitoring** - Track when seats become available in full classes
- **Instructor Tracking** - Get notified when "Staff" instructors are assigned to specific professors
- **Real-time Updates** - Dashboard updates live via Supabase Realtime subscriptions
- **Email Notifications** - Instant email alerts via Resend when changes are detected
- **Smart Deduplication** - Prevents duplicate notifications using atomic PostgreSQL operations
- **Circuit Breaker** - Distributed fault tolerance with Durable Objects
- **Scalable Queue Processing** - Handles 10,000+ users with parallel Cloudflare Queues
- **30-Minute Checks** - Automated scraping via Cloudflare Workers Cron Triggers

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
- **Durable Objects**: Distributed coordination for circuit breakers and cron locks
- **Workers KV**: Edge caching for fast data retrieval
- **Hyperdrive**: Connection pooling for PostgreSQL with automatic optimization

### Reliability
- **Automatic Failover**: Built-in redundancy across data centers
- **DDoS Protection**: Enterprise-grade security by default
- **99.99% Uptime SLA**: Production-grade reliability

### Developer Experience
- **OpenNext Compatibility**: Deploy standard Next.js apps without modification
- **Instant Deployments**: Sub-second deployments via Wrangler CLI
- **Integrated Monitoring**: Real-time logs and analytics

## Architecture

```
User Browser
     |
     v
Next.js App (Cloudflare Workers) <---> Supabase (Auth + PostgreSQL + Realtime)
     |
     v
Cloudflare Cron (every 30 min)
     |
     v
Cloudflare Queue (class-check-queue)
     |
     v
Queue Consumers (100+ concurrent Workers)
     |                    |
     v                    v
Durable Objects      Scraper Service
(Circuit Breaker)    (Puppeteer on external server)
     |                    |
     v                    v
Change Detection <--- ASU Class Search
     |
     v
Resend Email API --> User Notifications
```

### Key Components

| Component | Purpose |
|-----------|---------|
| `worker.ts` | Custom Cloudflare Worker with cron, queue handlers, and Durable Objects |
| `app/api/cron/route.ts` | Cron job entry point - enqueues sections to queue |
| `app/api/queue/process-section/route.ts` | Queue consumer - processes single section |
| `lib/db/queries.ts` | Database query helpers with atomic deduplication |
| `scraper/` | Standalone Puppeteer service for web scraping |

### Durable Objects

**CircuitBreakerDO** - Distributed fault tolerance
- States: CLOSED (healthy) -> OPEN (blocking, 10 failures) -> HALF_OPEN (testing recovery)
- Single instance coordinates all 100+ Worker isolates
- Prevents cascade failures when scraper is down

**CronLockDO** - Prevents duplicate cron executions
- Auto-expires after 25 minutes
- Ensures only one cron job runs at a time across all isolates

## Self-Hosting Guide

### Prerequisites

- [Bun](https://bun.sh/) (package manager)
- [Supabase Account](https://supabase.com/) (free tier available)
- [Cloudflare Account](https://cloudflare.com/) (free tier available)
- [Resend Account](https://resend.com/) (free tier: 100 emails/day)
- A server for the Puppeteer scraper (Oracle Cloud free tier recommended)

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
   bunx supabase gen types typescript --linked > lib/supabase/database.types.ts
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
| `SCRAPER_URL` | URL to your scraper service | Your deployed scraper URL |
| `SCRAPER_SECRET_TOKEN` | Auth token for scraper | Generate: `openssl rand -hex 32` |
| `RESEND_API_KEY` | Resend API key | [resend.com/api-keys](https://resend.com/api-keys) |
| `CRON_SECRET` | Auth for cron endpoint | Generate: `openssl rand -hex 32` |

### 4. Update Cloudflare Configuration

Edit `wrangler.jsonc` and update the placeholder values:

```jsonc
{
  "vars": {
    "NOTIFICATION_FROM_EMAIL": "notifications@your-domain.com",
    "NEXT_PUBLIC_SITE_URL": "https://your-domain.com",
    "NEXT_PUBLIC_SUPABASE_URL": "https://your-project-id.supabase.co",
    "SCRAPER_URL": "https://your-scraper-url.example.com"
  }
}
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

### 5. Deploy the Scraper Service

See [`scraper/README.md`](scraper/README.md) for detailed deployment instructions.

Recommended setup:
- Oracle Cloud Always Free tier (4 CPUs, 24GB RAM)
- Docker + Coolify for easy deployment
- Cloudflare Tunnel for secure public access

### 6. Set Cloudflare Secrets

```bash
# Authenticate with Cloudflare
wrangler login

# Set secrets (you'll be prompted for values)
wrangler secret put NEXT_PUBLIC_SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SCRAPER_SECRET_TOKEN
wrangler secret put RESEND_API_KEY
wrangler secret put RESEND_WEBHOOK_SECRET
wrangler secret put CRON_SECRET
```

### 7. Deploy

```bash
bun run deploy
```

Your app will be live at `https://your-worker.workers.dev` or your custom domain.

### 8. Set Up Cloudflare Queues

Create the required queues in Cloudflare Dashboard:

1. Go to Workers & Pages -> Queues
2. Create `class-check-queue`
3. Create `class-check-dlq` (dead letter queue)

### 9. Customize Legal Pages (Optional)

The `app/legal/` directory contains Terms of Service and Privacy Policy pages with ASU-specific content and hardcoded email addresses (`support@pickmyclass.app`). For your deployment:

- Update contact email addresses in:
  - `app/legal/page.tsx`
  - `app/legal/terms/page.tsx`
  - `app/legal/privacy/page.tsx`
- Review and customize legal content for your institution/jurisdiction
- Update the privacy policy to reflect your data practices

### 10. Verify Deployment

- Check the health endpoint: `https://your-domain.com/api/monitoring/health`
- Verify cron triggers in Cloudflare Dashboard -> Workers -> Triggers
- Test by adding a class watch in the dashboard

## Development

### Local Development

```bash
bun run dev              # Start Next.js dev server (localhost:3000)
```

### Preview with Cloudflare

```bash
bun run preview          # Build with OpenNext and preview locally
```

### Other Commands

```bash
bun run build            # Build Next.js application
bun run lint             # Run Biome linter
bun run lint:fix         # Fix lint issues
bun run format           # Format code with Biome
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

- **Frontend**: Next.js 15.5 (App Router), React 19, TypeScript, Tailwind CSS 4
- **Backend**: Cloudflare Workers (via OpenNext), Supabase (PostgreSQL + Auth + Realtime)
- **Scraper**: Puppeteer, Express.js, deployed on Oracle Cloud
- **Email**: Resend (transactional emails)
- **Deployment**: Cloudflare Workers + Pages

## Project Structure

```
app/                         # Next.js App Router
  ├── api/
  │   ├── class-watches/     # CRUD API for user watches
  │   ├── cron/              # Cloudflare Workers cron handler
  │   ├── queue/             # Queue consumer handlers
  │   └── webhooks/          # Resend webhook handlers
  ├── dashboard/             # Main dashboard with Realtime updates
  ├── login/                 # Authentication pages
  └── layout.tsx             # Root layout

lib/
  ├── supabase/              # Supabase clients (browser, server, service)
  ├── db/                    # Database query helpers
  ├── email/                 # Resend integration + templates
  └── hooks/                 # React hooks (Realtime subscriptions)

components/
  ├── ui/                    # shadcn/ui components
  └── ...                    # Feature components

supabase/
  └── migrations/            # Database migrations

scraper/                     # Standalone Puppeteer service
  ├── src/
  │   ├── index.ts           # Express server
  │   ├── scraper.ts         # Puppeteer logic
  │   ├── circuit-breaker.ts # Fault tolerance
  │   └── queue.ts           # Request queue
  └── Dockerfile             # Container definition

worker.ts                    # Custom Cloudflare Worker
wrangler.jsonc               # Cloudflare Workers config
```

## How It Works

1. **User adds class watch** - Student enters section number on dashboard
2. **Every 30 minutes** - Cloudflare cron triggers enqueue all watched sections
3. **Queue consumers process** - 100+ Workers scrape sections in parallel
4. **Circuit breaker protects** - Durable Object coordinates failure handling
5. **Change detection** - Compare new state with PostgreSQL cached state
6. **Atomic deduplication** - PostgreSQL `INSERT...ON CONFLICT` prevents race conditions
7. **Email notification** - Resend batch API sends alerts for available seats
8. **Real-time update** - Dashboard reflects changes via Supabase Realtime

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

- [OpenNext](https://opennext.js.org/) - Next.js adapter for Cloudflare Workers
- [Supabase](https://supabase.com/) - Open source Firebase alternative
- [Resend](https://resend.com/) - Modern email API
- [shadcn/ui](https://ui.shadcn.com/) - UI component library
