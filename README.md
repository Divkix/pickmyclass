# PickMyClass

A high-performance, scalable class seat notification system for university students. Monitor class availability, get notified when seats open up, and track instructor assignments.

Built with Next.js 15, Supabase, BullMQ, and deployed via Docker containers.

## Features

- **Seat Monitoring** - Track when seats become available in full classes
- **Instructor Tracking** - Get notified when "Staff" instructors are assigned to specific professors
- **Real-time Updates** - Dashboard updates live via Supabase Realtime subscriptions
- **Email Notifications** - Instant email alerts via Resend when changes are detected
- **Smart Deduplication** - Prevents duplicate notifications using atomic PostgreSQL operations
- **Circuit Breaker** - Redis-based distributed fault tolerance (fail-closed on errors)
- **Scalable Queue Processing** - Handles 10,000+ users with BullMQ parallel workers
- **30-Minute Checks** - Automated scraping via node-cron with staggered execution
- **Distributed Locking** - Redis-based cron lock with exponential backoff retry

## Architecture

```
User Browser
     |
     v
Next.js App (Docker) <---> Supabase (Auth + PostgreSQL + Realtime)
     |
     v
node-cron (every 30 min)
     |
     v
BullMQ Queue (Redis)
     |
     v
Queue Workers (4 concurrent)
     |                    |
     v                    v
Circuit Breaker      Scraper Service
(Redis-based)        (Puppeteer on Oracle Cloud)
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
| `server.ts` | Unified entry point - starts Next.js, cron scheduler, queue workers |
| `lib/redis/client.ts` | Redis client singletons (general + BullMQ) |
| `lib/redis/circuit-breaker.ts` | Redis-based circuit breaker with UNKNOWN state |
| `lib/redis/cron-lock.ts` | Distributed lock for cron job deduplication |
| `lib/queue/queues.ts` | BullMQ queue definitions and enqueue helpers |
| `lib/queue/worker.ts` | BullMQ worker - processes class check jobs |
| `lib/cron/scheduler.ts` | node-cron scheduler setup |
| `lib/cron/class-check.ts` | Cron job logic with retry mechanism |
| `lib/db/queries.ts` | Database query helpers with atomic deduplication |
| `scraper/` | Standalone Puppeteer service on Oracle Cloud |
| `Dockerfile` | Multi-stage production build |
| `docker-compose.yml` | Development with local Redis |
| `docker-compose.prod.yml` | Production with Upstash Redis |

### Circuit Breaker (Redis-based)

Distributed fault tolerance for scraper service:
- States: `CLOSED` (healthy) → `OPEN` (blocking, 10 failures) → `HALF_OPEN` (testing recovery) → `UNKNOWN` (Redis unavailable)
- **Fail-closed**: Blocks requests when Redis is unavailable (prevents cascade failures)
- Thresholds: 10 failures to open, 2-minute timeout, 3 successes to close

### Cron Lock (Redis-based)

Prevents duplicate cron executions:
- Uses Redis `SET NX PX` for atomic lock acquisition with 25-minute TTL
- Lua script for atomic conditional release
- **Exponential backoff retry**: 10 attempts, 5-second initial delay, 5-minute max total time

## Self-Hosting Guide

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/)
- [Supabase Account](https://supabase.com/) (free tier available)
- [Upstash Redis](https://upstash.com/) (free tier available) or self-hosted Redis
- [Resend Account](https://resend.com/) (free tier: 100 emails/day)
- A server for the Puppeteer scraper (Oracle Cloud free tier recommended)

### 1. Clone and Configure

```bash
git clone https://github.com/yourusername/pickmyclass.git
cd pickmyclass
```

Create `.env` file:

```bash
cat > .env << 'EOF'
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Redis (Upstash recommended for production)
REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379

# Scraper Service
SCRAPER_URL=https://your-scraper.example.com
SCRAPER_SECRET_TOKEN=your-secret-token

# Email (Resend)
RESEND_API_KEY=re_xxx
RESEND_WEBHOOK_SECRET=whsec_xxx

# Security
CRON_SECRET=your-cron-secret

# Site
SITE_URL=https://yourdomain.com
EOF
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Install Supabase CLI: `bun add -g supabase`
3. Link your project:
   ```bash
   bunx supabase link --project-ref your-project-id
   ```
4. Push database migrations:
   ```bash
   bunx supabase db push
   ```
5. Generate TypeScript types:
   ```bash
   bunx supabase gen types typescript --linked > lib/supabase/database.types.ts
   ```

### 3. Deploy the Scraper Service

See [`scraper/README.md`](scraper/README.md) for detailed deployment instructions.

Recommended setup:
- Oracle Cloud Always Free tier (4 CPUs, 24GB RAM)
- Docker deployment
- Cloudflare Tunnel for secure public access

### 4. Deploy with Docker

#### Development (with local Redis)

```bash
docker compose up --build
```

#### Production (with Upstash Redis)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### 5. Set Up HTTPS

Use one of these options:

**Option A: Cloudflare Tunnel (Recommended)**
```bash
cloudflared tunnel --url http://localhost:3000
```

**Option B: Nginx Reverse Proxy**
```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Option C: Traefik**
```yaml
# Add labels to docker-compose.yml
services:
  app:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.pickmyclass.rule=Host(`yourdomain.com`)"
      - "traefik.http.routers.pickmyclass.tls.certresolver=letsencrypt"
```

### 6. Verify Deployment

```bash
# Health check
curl http://localhost:3000/api/monitoring/health

# View logs
docker compose logs -f app

# Check cron is running (wait for :00 or :30)
docker compose logs app | grep "\[Cron\]"
```

### 7. Customize Legal Pages (Optional)

Update contact email addresses in:
- `app/legal/page.tsx`
- `app/legal/terms/page.tsx`
- `app/legal/privacy/page.tsx`

## Docker Commands

| Task | Command |
|------|---------|
| Start (dev) | `docker compose up --build` |
| Start (prod) | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` |
| View logs | `docker compose logs -f app` |
| Rebuild | `docker compose build app && docker compose up -d app` |
| Stop | `docker compose down` |
| Update & deploy | `git pull && docker compose up -d --build` |
| Shell access | `docker compose exec app sh` |
| Health check | `curl http://localhost:3000/api/monitoring/health` |

## Development

### Local Development (without Docker)

```bash
bun install
bun run dev              # Start Next.js dev server (localhost:3000)
```

### Commands

```bash
bun run dev              # Start Next.js dev server
bun run build            # Build Next.js application
bun run start:prod       # Start production server (Next.js + cron + workers)
bun run lint             # Run Biome linter
bun run lint:fix         # Fix lint issues
bun run format           # Format code with Biome
bun run knip             # Find unused exports/dependencies
```

### Database Commands

```bash
bunx supabase db push                        # Push migrations to remote
bunx supabase db pull                        # Pull remote schema changes
bunx supabase migration new <name>           # Create new migration
bunx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (bypasses RLS) |
| `REDIS_URL` | Yes | Redis connection URL (`redis://` or `rediss://` for TLS) |
| `SCRAPER_URL` | Yes | URL to your scraper service |
| `SCRAPER_SECRET_TOKEN` | Yes | Auth token for scraper |
| `RESEND_API_KEY` | Yes | Resend API key |
| `RESEND_WEBHOOK_SECRET` | No | Resend webhook secret |
| `CRON_SECRET` | Yes | Auth for cron endpoint |
| `SITE_URL` | No | Public site URL (for emails) |
| `PORT` | No | Server port (default: 3000) |

## Tech Stack

- **Frontend**: Next.js 15.5 (App Router), React 19, TypeScript, Tailwind CSS 4
- **Backend**: Node.js, BullMQ (job queue), node-cron (scheduler)
- **Database**: Supabase (PostgreSQL + Auth + Realtime)
- **Cache/Queue**: Redis (Upstash or self-hosted)
- **Scraper**: Puppeteer, Express.js, deployed on Oracle Cloud
- **Email**: Resend (transactional emails)
- **Deployment**: Docker, Docker Compose

## Project Structure

```
├── app/                      # Next.js App Router
│   ├── api/
│   │   ├── class-watches/    # CRUD API for user watches
│   │   ├── cron/             # HTTP trigger for cron
│   │   ├── monitoring/       # Health check endpoint
│   │   └── webhooks/         # Resend webhook handlers
│   ├── dashboard/            # Main dashboard with Realtime updates
│   ├── login/                # Authentication pages
│   └── layout.tsx            # Root layout
├── lib/
│   ├── supabase/             # Supabase clients (browser, server, service)
│   ├── redis/                # Redis client, circuit breaker, cron lock
│   ├── queue/                # BullMQ queue and worker
│   ├── cron/                 # Cron scheduler and job logic
│   ├── db/                   # Database query helpers
│   ├── email/                # Resend integration + templates
│   └── hooks/                # React hooks (Realtime subscriptions)
├── components/
│   ├── ui/                   # shadcn/ui components
│   └── ...                   # Feature components
├── supabase/
│   └── migrations/           # Database migrations
├── scraper/                  # Standalone Puppeteer service
├── server.ts                 # Unified server entry point
├── Dockerfile                # Multi-stage production build
├── docker-compose.yml        # Development with local Redis
└── docker-compose.prod.yml   # Production with Upstash
```

## How It Works

1. **User adds class watch** - Student enters section number on dashboard
2. **Every 30 minutes** - node-cron triggers with distributed lock
3. **Lock retry** - Exponential backoff if another instance holds the lock
4. **Queue processing** - BullMQ workers (4 concurrent) scrape sections in parallel
5. **Circuit breaker protects** - Redis-based coordination with fail-closed behavior
6. **Change detection** - Compare new state with PostgreSQL cached state
7. **Atomic deduplication** - PostgreSQL `INSERT...ON CONFLICT` prevents race conditions
8. **Email notification** - Resend batch API sends alerts for available seats
9. **Real-time update** - Dashboard reflects changes via Supabase Realtime

## Graceful Shutdown

Server handles SIGTERM/SIGINT with ordered shutdown (30s timeout):
1. Stop accepting new HTTP requests
2. Stop cron scheduler
3. Wait for current queue jobs to complete
4. Close queue connections
5. Close Redis connections

## Monitoring

- **Health endpoint**: `GET /api/monitoring/health` - Redis, queue stats, circuit breaker, cron lock status
- **Scraper status**: `GET <scraper-url>/status` - Browser pool metrics
- **Docker logs**: `docker compose logs -f app`
- **Queue metrics**: Via health endpoint (waiting, active, completed, failed counts)

## Admin System

Admins are flagged via `user_profiles.is_admin` boolean.

**Promote user to admin:**
```sql
UPDATE user_profiles
SET is_admin = true
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'user@example.com');
```

User must log out and back in for admin status to take effect.

## Troubleshooting

### Container not starting
```bash
docker compose logs app
# Check for missing env vars or Redis connection issues
```

### Cron not running
```bash
docker compose logs app | grep "\[Cron\]"
# Manual trigger:
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron
```

### Redis connection fails
- Verify `REDIS_URL` is correct
- For Upstash, use `rediss://` protocol (TLS)
- For local Redis, use `redis://localhost:6379`

### Circuit breaker stuck OPEN
```bash
# Check health endpoint for circuit breaker state
curl http://localhost:3000/api/monitoring/health | jq .circuitBreaker
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run linting: `bun run lint:fix`
5. Commit with conventional commits: `git commit -m "feat: add new feature"`
6. Push and open a PR

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Supabase](https://supabase.com/) - Open source Firebase alternative
- [BullMQ](https://docs.bullmq.io/) - Premium message queue for Node.js
- [Resend](https://resend.com/) - Modern email API
- [shadcn/ui](https://ui.shadcn.com/) - UI component library
