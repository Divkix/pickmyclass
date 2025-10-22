# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PickMyClass is a class seat notification system inspired by the original [pickaclass.app](https://www.pickaclass.app) (now defunct). Built with Next.js 15.5, Supabase authentication, and deployed on Cloudflare Workers via OpenNext.

### Product Concept
Students add university class sections they want to monitor by section number. The system:
1. Checks ASU's class search API every 15 minutes via Cloudflare Workers Cron Triggers
2. Detects when seats become available in full classes
3. Detects when "Staff" instructors are assigned to specific professors
4. Sends email notifications to all users watching that section

### Current Status
- ✅ Authentication system (login/register/password-reset) with Supabase
- ✅ Cloudflare Workers deployment setup
- ✅ Database schema with RLS policies
- ✅ Class monitoring dashboard with Realtime updates
- ✅ API routes for managing class watches
- ✅ ASU Class Search scraper service (Puppeteer-based, ready for deployment)
- 🚧 Cron job for 15-minute checks (TODO)
- 🚧 Email notification system (TODO)

### Future Plans
- Support for additional universities beyond ASU

## Key Commands

### Development
```bash
bun run dev              # Start Next.js development server on localhost:3000
bun run build            # Build the Next.js application
bun run lint             # Run ESLint
```

### Cloudflare Workers Deployment
```bash
bun run preview          # Build with OpenNext and preview locally on Cloudflare Workers
bun run deploy           # Build and deploy to Cloudflare Workers
bun run cf-typegen       # Generate TypeScript types for Cloudflare environment bindings
```

### Clean Build
```bash
rm -rf .next .open-next && bun run preview    # Clean build artifacts before preview
```

### Database Management
```bash
bunx supabase db push              # Push local migrations to remote database
bunx supabase gen types typescript --linked > lib/supabase/database.types.ts  # Generate TypeScript types
bunx supabase db pull              # Pull remote schema changes to local
bunx supabase migration new <name> # Create a new migration file
```

### Scraper Service (in scraper/ directory)
```bash
bun run dev        # Start scraper service in watch mode (localhost:3000)
bun run build      # Compile TypeScript to JavaScript
bun run start      # Run production build
bun run typecheck  # Type check without building
```

## Architecture

### Authentication System
- **Supabase SSR**: Authentication is handled via `@supabase/ssr` with server and client implementations
- **Client**: `lib/supabase/client.ts` - Browser client using `createBrowserClient`
- **Server**: `lib/supabase/server.ts` - Server client using `createServerClient` with cookie handling
- **Context**: `lib/contexts/AuthContext.tsx` - React context providing `user`, `session`, `loading`, and `signOut`
- **Middleware**: `proxy.ts` - Proxy middleware per Next.js 16 convention (not `middleware.ts`), handles:
  - Session refresh
  - Protected route redirects
  - Public routes: `/login`, `/register`, `/forgot-password`, `/reset-password`
  - Redirects authenticated users away from auth pages
  - Matches all routes except static assets

### Environment Variables
Required configuration (see `.env.example`):

**Supabase:**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key

**Scraper Service:**
- `SCRAPER_URL` - URL to scraper service (e.g., `https://scraper.yourdomain.com` or `http://localhost:3000` for local dev)
- `SCRAPER_SECRET_TOKEN` - Bearer token for authenticating with scraper (must match token in `scraper/.env`)

**Build Handling**: Both client and server Supabase utilities use placeholder values during build when env vars are unavailable, preventing build failures. The scraper integration gracefully falls back to stub data if `SCRAPER_URL` is not configured, enabling development without the scraper service running.

### Database Access via Hyperdrive
- **Hyperdrive**: Cloudflare's connection pooling service for PostgreSQL/MySQL databases
- **Purpose**: Provides fast, pooled connections from Workers to Supabase PostgreSQL
- **Utility**: `lib/db/hyperdrive.ts` - Helper functions for querying via Hyperdrive
- **When to use**:
  - ✅ Cron jobs that query the database
  - ✅ API routes needing direct SQL access
  - ✅ High-frequency database operations
- **When NOT to use**:
  - ❌ Supabase Auth operations (use Supabase client)
  - ❌ Supabase Storage/Realtime (use Supabase client)
  - ❌ Operations requiring Row Level Security

**Setup Instructions**:
1. Create Hyperdrive config via Cloudflare Dashboard:
   - Go to Workers & Pages → Hyperdrive → Create Configuration
   - Name: `pickmyclass-db`
   - Connection string: `postgresql://postgres:[password]@db.[project-id].supabase.co:5432/postgres`
2. Add Hyperdrive binding to `wrangler.jsonc`:
   ```jsonc
   {
     "hyperdrive": [
       {
         "binding": "HYPERDRIVE",
         "id": "your-hyperdrive-id-here"
       }
     ]
   }
   ```
3. Use in Workers code:
   ```typescript
   import { queryHyperdrive } from '@/lib/db/hyperdrive';

   export async function GET(request: Request, { env }: { env: { HYPERDRIVE: Hyperdrive } }) {
     const result = await queryHyperdrive(
       env.HYPERDRIVE,
       'SELECT * FROM class_watches WHERE user_id = $1',
       [userId]
     );
     return Response.json(result.rows);
   }
   ```

**Connection Details**:
- Supabase connection string: `postgresql://postgres:puhdip-vunfYk-xanhi4@db.osopxwuebsefhoxgeojh.supabase.co:5432/postgres`
- Driver: `pg` (node-postgres) version 8.16.3+
- Connection pool limit: 5 (Workers have 6 connection limit)

### Project Structure
```
app/                         # Next.js App Router pages
  ├── api/
  │   └── class-watches/     # API routes for class watch CRUD
  ├── dashboard/             # Dashboard page with Realtime updates
  ├── login/                 # Login page
  ├── register/              # Registration page
  ├── forgot-password/       # Password reset request
  ├── reset-password/        # Password reset form
  ├── layout.tsx             # Root layout with AuthProvider
  └── page.tsx               # Home page

lib/
  ├── supabase/
  │   ├── client.ts          # Browser client (typed)
  │   ├── server.ts          # Server client (typed)
  │   └── database.types.ts  # Generated database types
  ├── hooks/
  │   └── useRealtimeClassStates.ts  # Realtime subscription hook
  └── contexts/
      └── AuthContext.tsx    # Auth context

components/
  ├── ui/                    # shadcn/ui components
  ├── AuthButton.tsx         # Authentication button
  ├── ClassWatchCard.tsx     # Individual class watch card
  ├── AddClassWatch.tsx      # Form to add new watch
  └── ClassStateIndicator.tsx # Status indicator component

supabase/
  ├── config.toml            # Supabase CLI configuration
  └── migrations/            # Database migration files

scraper/                     # Standalone scraper service (Puppeteer)
  ├── src/
  │   ├── index.ts          # Express server with auth
  │   ├── scraper.ts        # Puppeteer scraping logic
  │   └── types.ts          # TypeScript interfaces
  ├── Dockerfile            # Production container
  ├── docker-compose.yml    # Coolify deployment config
  ├── package.json          # Dependencies & scripts
  ├── tsconfig.json         # TypeScript config
  └── README.md             # Scraper documentation

proxy.ts                     # Middleware for auth and session management
open-next.config.ts          # OpenNext configuration for Cloudflare Workers
wrangler.jsonc               # Cloudflare Workers configuration
```

### Deployment Target
- **Primary**: Cloudflare Workers via OpenNext (`@opennextjs/cloudflare`)
- **Build Output**: `.open-next/` directory contains worker and assets
- **Assets Binding**: Configured in `wrangler.jsonc` as `ASSETS`
- **Compatibility**: Uses `nodejs_compat` flag for Node.js API support

### TypeScript Configuration
- Path alias: `@/*` maps to project root
- Target: ES2017
- Strict mode enabled

## Development Notes

### Next.js Version
- Currently on Next.js 15.5.0 (upgraded from 15.3.0)
- Previous downgrade to 15.3.0 was for Cloudflare Workers compatibility
- Middleware migrated to `proxy.ts` per Next.js 16 convention

### Authentication Flow
1. User navigates to protected route
2. `proxy.ts` checks session via Supabase
3. Redirects to `/login` if unauthenticated
4. `AuthContext` manages client-side auth state
5. Auth state changes trigger re-renders via context

### Styling
- Tailwind CSS 4 with PostCSS
- Dark mode support using `dark:` prefix
- Geist and Geist Mono fonts loaded via `next/font/google`
- Color scheme: Zinc palette (50, 200, 400, 600, 800, 900, 950)

## Common Issues

### Supabase Env Vars During Build
If builds fail due to missing Supabase credentials, ensure placeholder logic in `lib/supabase/client.ts` and `lib/supabase/server.ts` is intact. These files gracefully handle missing env vars during build.

### Cloudflare Workers Compatibility
When adding dependencies or Node.js APIs, verify compatibility with Cloudflare Workers runtime. Use `wrangler` to test locally before deploying.

## ASU Class Search Integration

### Search Method
Users search for classes by **section number** (e.g., `12431`) using the keyword field on ASU's class search:
```
https://catalog.apps.asu.edu/catalog/classes/classlist?keywords=12431&term=2261
```

### API Discovery
ASU uses an internal API:
```
https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search
```

**Key Endpoints:**
- `GET /classes?keywords=12431&term=2261` - Search by section number (keyword)
- `GET /terms` - Get available terms
- `GET /subjects?sl=Y&term=2261` - Get subjects for a term

### ⚠️ API Authentication Issue
The API returns **401 Unauthorized** when called directly (without browser context). Additionally, the ASU class search page **loads data dynamically via JavaScript**, so simple HTML fetching won't work.

### ✅ Implementation Status

**Scraper Service: COMPLETE**

The scraper service has been fully implemented in the `scraper/` directory using Puppeteer for browser automation:

**Location:** `/scraper/`

**Key Features:**
- Express server with Bearer token authentication
- Puppeteer-based scraping of ASU class search (handles React SPA)
- Browser instance pooling for performance optimization
- Request interception to block images/fonts (saves bandwidth)
- Comprehensive error handling and logging
- TypeScript with strict typing
- Docker + docker-compose for deployment
- Ready for Coolify deployment on Oracle Cloud

**Endpoints:**
- `GET /health` - Health check
- `POST /scrape` - Scrape class details (requires Bearer auth)

**Integration:**
- Main app's `/api/fetch-class-details` route calls scraper service
- Graceful fallback to stub data if scraper not configured
- Environment variables: `SCRAPER_URL` and `SCRAPER_SECRET_TOKEN`

**Deployment:**
1. Push to Git repo
2. Deploy via Coolify on Oracle Cloud (Docker Compose)
3. Configure Cloudflare Tunnel at `scraper.yourdomain.com`
4. Set environment variables in main app

**Documentation:** See `scraper/README.md` for detailed setup and API documentation.

---

### Implementation Options (For Reference)

The following section documents the planning and architecture decisions that led to the current implementation:

#### **Option 1: Oracle Free Tier + Coolify + Cloudflare Tunnel (RECOMMENDED)**
Use your existing Oracle Cloud free tier server with Coolify and Cloudflare Tunnel.

**What You Have:**
- Oracle Cloud Free Tier (4 ARM CPUs, 24GB RAM - permanent free tier)
- Coolify (self-hosted PaaS for easy Docker deployments)
- Cloudflare Tunnel (secure public HTTPS access without exposing IP)

**Cost: $0/month** ✅

**Architecture:**
```
Cloudflare Workers (cron every 15 min)
  ↓ HTTPS POST (with Bearer token auth)
Cloudflare Tunnel → https://scraper.yourdomain.com
  ↓ Secure tunnel
Oracle Server (Coolify-managed Puppeteer container)
  ↓ Scrape with headless Chromium
ASU Class Search Website
  ↓ Return parsed data
Cloudflare Workers
  ↓ Store in
Supabase Database
```

**Implementation Steps:**

**1. Create Puppeteer Service Structure:**
```
scraper-service/
├── package.json
├── docker-compose.yml  # For Coolify
├── Dockerfile
└── src/
    ├── index.ts        # Express server
    └── scraper.ts      # Puppeteer logic
```

**2. Docker Compose for Coolify:**
```yaml
services:
  asu-scraper:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - SECRET_TOKEN=${SECRET_TOKEN}  # Set in Coolify
    restart: unless-stopped
```

**3. Dockerfile:**
```dockerfile
FROM node:18-slim

# Install Chromium dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

EXPOSE 3000
CMD ["node", "src/index.js"]
```

**4. Express Server with Authentication (src/index.ts):**
```typescript
import express from 'express';
import { scrapeClassSection } from './scraper';

const app = express();
app.use(express.json());

// Bearer token authentication
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.SECRET_TOKEN;

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/scrape', authenticate, async (req, res) => {
  try {
    const { sectionNumber, term } = req.body;

    if (!sectionNumber || !term) {
      return res.status(400).json({ error: 'Missing sectionNumber or term' });
    }

    const result = await scrapeClassSection(sectionNumber, term);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Scraper service running on port ${PORT}`);
});
```

**5. Deploy to Coolify:**
- Create new service in Coolify
- Point to your Git repo or use Docker Compose directly
- Set environment variable: `SECRET_TOKEN=your-random-token-here`
- Coolify will automatically build and deploy

**6. Configure Cloudflare Tunnel:**
```bash
# If not already set up, create tunnel route
cloudflared tunnel route dns <tunnel-name> scraper.yourdomain.com
```

Now accessible at: `https://scraper.yourdomain.com/scrape`

**7. Call from Cloudflare Workers:**
```typescript
// In app/api/cron/route.ts
const response = await fetch('https://scraper.yourdomain.com/scrape', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${env.SCRAPER_SECRET_TOKEN}`,
  },
  body: JSON.stringify({ sectionNumber: '12431', term: '2261' }),
});
```

**Pros:**
- ✅ **$0/month** - Everything already paid for
- ✅ **Powerful hardware** - 4 CPUs, 24GB RAM (vs Fly.io's 256MB)
- ✅ **Coolify** - Easy deployment like Railway/Vercel
- ✅ **Cloudflare Tunnel** - Secure public access, DDoS protection
- ✅ **Full control** - Customize everything
- ✅ **Permanent free tier** - Oracle won't remove it

**Cons:**
- ❌ Must keep Oracle server online
- ❌ Need to maintain infrastructure (but Coolify makes it easy)
- ❌ Cloudflare Tunnel adds ~50-100ms latency

**Security Notes:**
- ✅ Use Bearer token authentication (shown above)
- ✅ Cloudflare Tunnel hides your server IP
- ✅ Set rate limiting in Express if needed
- ✅ Consider using Cloudflare Access for additional security

---

#### **Option 2: Self-Hosted Puppeteer on Fly.io/Railway (Alternative)**
If you don't want to use your Oracle server:

**Platforms:**
- **Fly.io** - 3 free VMs, 256MB RAM each
- **Railway** - $5 free credits/month

**Cost: $0-5/month**

**Same architecture as Option 1, just different hosting.**

**Pros:**
- ✅ FREE or very cheap
- ✅ No server maintenance
- ✅ Auto-scaling and restarts

**Cons:**
- ❌ Less powerful than Oracle (256MB vs 24GB RAM)
- ❌ Another service to manage

---

#### **Option 3: External Scraping Service (Paid)**
ScrapingBee, Scraper API, or BrightData:
- ❌ **Cost**: $5-50/month
- ✅ Zero maintenance
- ✅ Built-in anti-bot measures

**Only use if Options 1 & 2 fail.**

---

#### **Option 4: Cloudflare Browser Rendering API (Expensive)**
- ❌ **Cost**: ~$22/month for your usage (200 hours/month)
- ❌ Less cost-effective than self-hosting

**Not recommended given your existing infrastructure.**

---

### Cost Comparison

| Solution | Monthly Cost | Hardware | Maintenance | Notes |
|----------|--------------|----------|-------------|-------|
| **Oracle + Coolify** | **$0** | 4 CPUs, 24GB RAM | Low (Coolify) | ✅ **BEST - Use existing infra** |
| Fly.io Free Tier | $0 | 256MB RAM | Low | Good alternative |
| Railway | $0-5 | Varies | Low | $5 credits/month |
| ScrapingBee | $5-50 | N/A | None | Paid service |
| Cloudflare Browser | ~$22 | N/A | None | Too expensive |

### Scraping Strategy
For each monitored section number:
1. Navigate to: `https://catalog.apps.asu.edu/catalog/classes/classlist?keywords={section_nbr}&term={term}`
2. Wait for results table to load (check for presence of data)
3. Extract from the HTML table:
   - **Section number**: Text in "Number" column
   - **Instructor**: Link text or "Staff" text in "Instructor(s)" column
   - **Seats available**: Parse "140 of 150" format from "Open Seats" column
   - **Course info**: Subject, catalog number, title, location, times

### Data to Monitor
Track these state changes:
- **Seat availability**: `"0 of 150"` → `"5 of 150"` (send notification)
- **Instructor assignment**: `"Staff"` → `"James Gordon"` (send notification)

### Implementation Notes
- Use Cloudflare Workers Cron Triggers (every 15 minutes)
- Store previous state in Supabase to detect changes
- Rate limit: Space out requests by 2-3 seconds between sections to avoid rate limiting
- Handle failures gracefully (retry logic, error logging)
- Consider batching: Group section checks to minimize scraping service costs

## Database Schema

All tables have Row Level Security (RLS) enabled. Migrations are managed via Supabase CLI in `supabase/migrations/`.

### Tables

#### `class_watches`
Stores which users are watching which class sections.
- **Columns**: `id`, `user_id`, `term`, `subject`, `catalog_nbr`, `class_nbr`, `created_at`
- **RLS**: Users can only CRUD their own watches (filtered by `user_id = auth.uid()`)
- **Constraints**: Unique constraint on `(user_id, term, class_nbr)` to prevent duplicates
- **Indexes**: `user_id`, `class_nbr`

#### `class_states`
Caches current state of monitored classes to detect changes.
- **Columns**: `id`, `term`, `subject`, `catalog_nbr`, `class_nbr`, `title`, `instructor_name`, `seats_available`, `seats_capacity`, `location`, `meeting_times`, `last_checked_at`, `last_changed_at`
- **RLS**: Authenticated users can read all states; only service_role can write
- **Constraints**: Unique `class_nbr` (section numbers are globally unique)
- **Indexes**: `class_nbr`, `last_checked_at`
- **Triggers**: Auto-updates `last_changed_at` when seats or instructor changes

#### `notifications_sent`
Tracks which notifications have been sent to avoid duplicates.
- **Columns**: `id`, `class_watch_id`, `notification_type`, `sent_at`
- **RLS**: Users can view notifications for their own watches; only service_role can insert
- **Constraints**: Unique `(class_watch_id, notification_type)` to prevent duplicate notifications
- **Indexes**: `class_watch_id`

### Realtime Subscriptions

The dashboard uses Supabase Realtime to live-update class states:

```typescript
// lib/hooks/useRealtimeClassStates.ts
// Subscribes to postgres_changes events on class_states table
// Filters by user's watched class numbers
// Auto-updates UI when seats or instructor changes
```

**Example usage in dashboard:**
```typescript
const { classStates, loading } = useRealtimeClassStates({
  classNumbers: ['12431', '12432'],
  enabled: true,
})
```

### API Routes

**GET /api/class-watches**
- Fetch all class watches for authenticated user
- Returns watches with joined class_states data
- Protected by Supabase auth (requires valid session)

**POST /api/class-watches**
- Add new class watch
- Body: `{ term, subject, catalog_nbr, class_nbr }`
- Validates section number (5 digits) and term (4 digits)
- Returns 409 if duplicate watch exists

**DELETE /api/class-watches?id={watch_id}**
- Remove a class watch
- RLS ensures user can only delete their own watches

## Cloudflare Workers Cron Configuration

Add to `wrangler.jsonc`:
```jsonc
{
  "triggers": {
    "crons": ["*/15 * * * *"]  // Every 15 minutes
  }
}
```

Create cron handler (TODO):
```typescript
// app/api/cron/route.ts or similar
export async function GET(request: Request) {
  // 1. Fetch unique class sections from class_watches
  // 2. Query ASU API for each section
  // 3. Compare with class_states to detect changes
  // 4. Send email notifications for changes
  // 5. Update class_states with new data
}
```
