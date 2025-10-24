# PickMyClass

A real-time class seat notification system for university students. Monitor class availability, get notified when seats open up, and track instructor assignments.

Inspired by the original [pickaclass.app](https://www.pickaclass.app) (now defunct), built with modern web technologies and deployed on Cloudflare Workers.

## Features

- **Seat Monitoring** - Track when seats become available in full classes
- **Instructor Tracking** - Get notified when "Staff" instructors are assigned to specific professors
- **Real-time Updates** - Dashboard updates live via Supabase Realtime subscriptions
- **Email Notifications** - Instant email alerts via Resend when changes are detected
- **Smart Deduplication** - Prevents duplicate notifications for the same event
- **High Performance** - Edge-first architecture with Workers KV cache layer (5-10x faster reads)
- **15-Minute Checks** - Automated hourly scraping via Cloudflare Workers Cron Triggers
- **User Authentication** - Secure login/register with Supabase Auth

## Tech Stack

- **Frontend**: Next.js 15.5 (App Router), React, TypeScript, Tailwind CSS 4
- **Backend**: Cloudflare Workers (OpenNext), Supabase (PostgreSQL + Auth + Realtime)
- **Scraper**: Puppeteer (headless Chrome), Express.js, deployed on Oracle Cloud via Coolify
- **Database**: PostgreSQL (Supabase) with Row Level Security (RLS)
- **Cache**: Cloudflare Workers KV (edge caching for 5-10x performance boost)
- **Email**: Resend (100 emails/day free tier)
- **Deployment**: Cloudflare Workers + Pages, Cloudflare Tunnel for scraper access

## Architecture

```
User Browser
  ↓
Next.js App (Cloudflare Workers)
  ↓
Supabase (Auth + PostgreSQL + Realtime)
  ↓
Cloudflare Workers Cron (every hour)
  ↓
Scraper Service (Oracle Cloud + Coolify + Cloudflare Tunnel)
  ↓
ASU Class Search Website
  ↓
Email Notifications (Resend)
```

### Key Components

- **Authentication**: Supabase SSR with `@supabase/ssr` (server + client)
- **Database Access**: Cloudflare Hyperdrive for fast PostgreSQL connection pooling
- **Caching**: Workers KV for edge caching with PostgreSQL fallback
- **Scraping**: Puppeteer service with browser pooling and request interception
- **Notifications**: Resend email service with HTML templates

## Prerequisites

- [Bun](https://bun.sh/) (package manager)
- [Supabase Account](https://supabase.com/) (free tier)
- [Cloudflare Account](https://cloudflare.com/) (free tier)
- [Resend Account](https://resend.com/) (free tier: 100 emails/day)
- [Oracle Cloud Account](https://cloud.oracle.com/) (optional, for scraper deployment)

## Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>
cd pickmyclass
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Set Up Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials:

```bash
# Supabase (from https://app.supabase.com/project/_/settings/api)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Scraper Service
SCRAPER_URL=http://localhost:3000  # or https://scraper.yourdomain.com
SCRAPER_SECRET_TOKEN=your_secret_token_here
SCRAPER_BATCH_SIZE=3

# Email Notifications (from https://resend.com/api-keys)
RESEND_API_KEY=re_your_api_key_here
NOTIFICATION_FROM_EMAIL=onboarding@resend.dev
```

### 4. Set Up Database

Initialize Supabase locally (optional) or use remote project:

```bash
# Link to your Supabase project
bunx supabase link --project-ref your-project-id

# Push migrations to remote database
bunx supabase db push

# Generate TypeScript types
bunx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

### 5. Run Development Server

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## Environment Variables

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | Yes | `eyJhbGc...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (bypasses RLS) | Yes | `eyJhbGc...` |
| `SCRAPER_URL` | URL to scraper service | Yes | `https://scraper.yourdomain.com` |
| `SCRAPER_SECRET_TOKEN` | Bearer token for scraper auth | Yes | `random-secure-token` |
| `SCRAPER_BATCH_SIZE` | Concurrent scrapes per batch (1-5) | No | `3` |
| `RESEND_API_KEY` | Resend API key | Yes | `re_xxx` |
| `RESEND_WEBHOOK_SECRET` | Resend webhook signing secret | Yes | `whsec_xxx` |
| `NOTIFICATION_FROM_EMAIL` | Verified sender email | Yes | `notifications@yourdomain.com` |
| `NEXT_PUBLIC_SITE_URL` | Base URL for unsubscribe links | Yes | `https://pickmyclass.app` |
| `CRON_SECRET` | Authentication secret for cron endpoint | Yes | `openssl rand -hex 32` |
| `SENTRY_DSN` | Sentry error tracking DSN | Recommended | `https://...@sentry.io/...` |
| `MAX_WATCHES_PER_USER` | Maximum watches per user | No | `10` |

See [`.env.example`](.env.example) for detailed descriptions.

## Deployment

### Deploy to Cloudflare Workers

1. **Install Wrangler CLI** (if not already installed):
   ```bash
   bun install -g wrangler
   ```

2. **Authenticate with Cloudflare**:
   ```bash
   wrangler login
   ```

3. **Set Up Cloudflare Hyperdrive** (database connection pooling):
   - Go to Workers & Pages → Hyperdrive → Create Configuration
   - Name: `pickmyclass-db`
   - Connection string: `postgresql://postgres:[password]@db.[project-id].supabase.co:5432/postgres`
   - Copy the Hyperdrive ID and update `wrangler.jsonc`

4. **Set Environment Variables**:

   **Method 1: Cloudflare Dashboard (Recommended)**
   - Go to Workers & Pages → Your Worker → Settings → Variables
   - Add these **encrypted secrets**:
     ```
     NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
     SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
     SCRAPER_SECRET_TOKEN=your-token
     RESEND_API_KEY=re_xxx
     RESEND_WEBHOOK_SECRET=whsec_xxx
     CRON_SECRET=<generate with: openssl rand -hex 32>
     SENTRY_DSN=https://...@sentry.io/...
     NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
     ```
   - Add these **plaintext variables**:
     ```
     NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
     SCRAPER_URL=https://scraper.yourdomain.com
     ```

   **Method 2: Wrangler CLI**
   ```bash
   # Secrets
   wrangler secret put NEXT_PUBLIC_SUPABASE_ANON_KEY
   wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   wrangler secret put SCRAPER_SECRET_TOKEN
   wrangler secret put RESEND_API_KEY
   wrangler secret put RESEND_WEBHOOK_SECRET
   wrangler secret put CRON_SECRET
   wrangler secret put SENTRY_DSN
   wrangler secret put NEXT_PUBLIC_SENTRY_DSN

   # Plaintext vars go in wrangler.jsonc or Dashboard
   ```

5. **Deploy**:
   ```bash
   bun run deploy
   ```

   Your app will be live at `https://your-worker.workers.dev`

### Set Up Resend Email Service

1. **Create Resend Account**:
   - Sign up at [resend.com](https://resend.com) (free tier: 100 emails/day, 3,000/month)
   - Verify your email address

2. **Get API Key**:
   - Go to [API Keys](https://resend.com/api-keys)
   - Click "Create API Key"
   - Name: `PickMyClass Production`
   - Copy the key → Set as `RESEND_API_KEY` in Cloudflare

3. **Verify Domain** (for production):

   **Option A: Use Resend's Test Domain (Development)**
   - Use `onboarding@resend.dev` as sender email
   - No verification needed
   - Limited to 1 email per recipient per day

   **Option B: Verify Your Own Domain (Production)**
   - Go to [Domains](https://resend.com/domains)
   - Click "Add Domain"
   - Enter your domain (e.g., `pickmyclass.app`)
   - Add DNS records (MX, TXT, CNAME) to your domain provider
   - Wait for verification (usually <5 minutes)
   - Use `notifications@yourdomain.com` as sender email

4. **Configure Webhooks** (for bounce/spam handling):
   - Go to [Webhooks](https://resend.com/webhooks)
   - Click "Add Webhook"
   - **Endpoint URL**: `https://yourdomain.com/api/webhooks/resend`
   - **Events to subscribe**:
     - ✅ `email.bounced` - Handle hard bounces
     - ✅ `email.complained` - Handle spam complaints
     - ✅ `email.delivered` - Track successful deliveries (optional)
   - Click "Create Webhook"
   - Copy the **Signing Secret** (starts with `whsec_...`)
   - Set as `RESEND_WEBHOOK_SECRET` in Cloudflare

5. **Test Email Delivery**:
   ```bash
   # Send test notification by adding a watch in the dashboard
   # Check Resend dashboard → Emails for delivery status
   ```

6. **Monitor Email Health**:
   - Check [Resend Dashboard](https://resend.com/emails) for:
     - Delivery rate (should be >95%)
     - Bounce rate (should be <5%)
     - Spam complaints (should be <0.1%)
   - High bounce/spam rates will trigger account suspension

### Deploy Scraper Service

See [`scraper/README.md`](scraper/README.md) for detailed deployment instructions using Coolify + Oracle Cloud + Cloudflare Tunnel.

## Database Management

### Create a New Migration

```bash
bunx supabase migration new <migration-name>
```

### Apply Migrations

```bash
# Local database
bunx supabase db reset

# Remote database
bunx supabase db push
```

### Generate TypeScript Types

```bash
bunx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

### Pull Remote Schema

```bash
bunx supabase db pull
```

## Development Commands

```bash
# Development
bun run dev              # Start Next.js dev server (localhost:3000)
bun run build            # Build for production
bun run lint             # Run ESLint

# Cloudflare Workers
bun run preview          # Build with OpenNext and preview locally
bun run deploy           # Deploy to Cloudflare Workers
bun run cf-typegen       # Generate Cloudflare env types

# Database
bunx supabase db push    # Push migrations to remote
bunx supabase gen types  # Generate TypeScript types

# Clean build
rm -rf .next .open-next && bun run preview
```

## Project Structure

```
app/                         # Next.js App Router
  ├── api/
  │   ├── class-watches/     # CRUD API for user watches
  │   ├── cron/              # Cloudflare Workers cron handler
  │   └── fetch-class-details/ # Scraper integration
  ├── dashboard/             # Main dashboard with Realtime updates
  ├── login/                 # Authentication pages
  └── layout.tsx             # Root layout with AuthProvider

lib/
  ├── supabase/              # Supabase clients (browser, server, service)
  ├── db/                    # Hyperdrive helpers + SQL queries
  ├── cache/                 # Workers KV cache layer
  ├── email/                 # Resend integration + templates
  └── hooks/                 # React hooks (Realtime subscriptions)

components/
  ├── ui/                    # shadcn/ui components
  ├── ClassWatchCard.tsx     # Class watch display
  └── AddClassWatch.tsx      # Add new watch form

supabase/
  └── migrations/            # Database migrations

scraper/                     # Standalone Puppeteer service
  ├── src/
  │   ├── index.ts          # Express server
  │   └── scraper.ts        # Puppeteer logic
  └── docker-compose.yml    # Coolify deployment

proxy.ts                     # Next.js 16 middleware (auth)
worker.ts                    # Custom Cloudflare Worker with cron
wrangler.jsonc               # Cloudflare Workers config
```

## How It Works

1. **User adds class watch** - Student enters section number (e.g., `12431`) on dashboard
2. **Hourly cron job runs** - Cloudflare Workers cron triggers every hour
3. **Scraper fetches data** - Puppeteer service scrapes ASU class search for current state
4. **Change detection** - Compares new state with cached state in Workers KV / PostgreSQL
5. **Send notifications** - If seats became available or instructor assigned, send emails via Resend
6. **Update cache** - Store new state in Workers KV + PostgreSQL for next check
7. **Real-time updates** - Dashboard updates live via Supabase Realtime subscriptions

## Contributing

This is a private project. Contributions are not currently accepted.

## License

**Proprietary** - All rights reserved. This is a private project and may not be copied, modified, or distributed without explicit permission.
