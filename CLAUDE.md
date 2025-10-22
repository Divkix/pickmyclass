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
- 🚧 Class monitoring dashboard (TODO)
- 🚧 ASU Class Search API integration (TODO)
- 🚧 Cron job for 15-minute checks (TODO)
- 🚧 Email notification system (TODO)
- 🚧 Database schema for class watches (TODO)

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
Required Supabase configuration (see `.env.example`):
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key

**Build Handling**: Both client and server Supabase utilities use placeholder values during build when env vars are unavailable, preventing build failures.

### Project Structure
```
app/                    # Next.js App Router pages
  ├── login/           # Login page
  ├── register/        # Registration page
  ├── forgot-password/ # Password reset request
  ├── reset-password/  # Password reset form
  ├── layout.tsx       # Root layout with AuthProvider
  └── page.tsx         # Home page (client component using useAuth)

lib/
  ├── supabase/        # Supabase client utilities
  └── contexts/        # React contexts (AuthContext)

components/            # React components
  └── AuthButton.tsx   # Authentication button component

proxy.ts               # Middleware for auth and session management
open-next.config.ts    # OpenNext configuration for Cloudflare Workers
wrangler.jsonc         # Cloudflare Workers configuration
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

### Implementation Options (Ranked by Cost)

#### **Option 1: Self-Hosted Puppeteer on Free Tier (RECOMMENDED)**
Deploy your own Puppeteer scraper service on free hosting:

**Recommended Platforms:**
- **Fly.io** - 3 free VMs forever, 3GB storage (BEST)
- **Railway** - $5 free credits/month
- **Google Cloud Run** - 2M requests/month free
- **Render** - 750 hours/month free tier

**Cost: $0/month** (or $0-5/month on Railway)

**Architecture:**
```
Cloudflare Workers (cron every 15 min)
  ↓ HTTP POST
Self-Hosted Puppeteer Service (Fly.io/Railway)
  ↓ Scrape
ASU Class Search Website
  ↓ Return parsed data
Cloudflare Workers
  ↓ Store in
Supabase Database
```

**Implementation Steps:**
1. Create a simple Express/Fastify API with Puppeteer
2. Single endpoint: `POST /scrape` accepts `{sectionNumber, term}`
3. Returns JSON: `{instructor, seatsAvailable, seatsCapacity}`
4. Deploy to Fly.io (free tier)
5. Workers cron calls: `POST https://your-scraper.fly.dev/scrape`

**Pros:**
- ✅ **FREE** or very cheap
- ✅ Full control over scraping logic
- ✅ Can optimize for ASU's specific site structure
- ✅ No per-request costs

**Cons:**
- ❌ Must maintain infrastructure
- ❌ Need to handle failures and retries
- ❌ May need to implement anti-bot measures if ASU blocks

**Example Puppeteer Service (TODO):**
```typescript
// scraper-service/src/index.ts
import express from 'express';
import puppeteer from 'puppeteer';

app.post('/scrape', async (req, res) => {
  const { sectionNumber, term } = req.body;
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(`https://catalog.apps.asu.edu/catalog/classes/classlist?keywords=${sectionNumber}&term=${term}`);
  await page.waitForSelector('.class-results-table'); // Wait for data to load

  const data = await page.evaluate(() => {
    // Extract instructor, seats, etc. from DOM
    const instructor = document.querySelector('.instructor-column')?.textContent;
    const seats = document.querySelector('.seats-column')?.textContent;
    return { instructor, seats };
  });

  await browser.close();
  res.json(data);
});
```

#### **Option 2: External Scraping Service (Paid)**
Use ScrapingBee, Scraper API, or BrightData if you want zero maintenance:
- ❌ **Cost**: $5-50/month for 4,800 requests/day
- ✅ No infrastructure to maintain
- ✅ Built-in anti-bot measures

**Only use if free tier doesn't work or you prefer managed service.**

#### **Option 3: Cloudflare Browser Rendering API (Not Recommended)**
- ❌ **Cost**: $5/month + usage fees
- ❌ 2M request/month limit
- Not cost-effective for this use case

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

## Database Schema (TODO)

### Proposed Tables

#### `class_watches`
Stores which users are watching which class sections.
```sql
- id (uuid, primary key)
- user_id (uuid, foreign key to auth.users)
- term (text) -- e.g., "2261"
- subject (text) -- e.g., "CSE"
- catalog_nbr (text) -- e.g., "240"
- class_nbr (text) -- e.g., "12431" (section number)
- created_at (timestamp)
```

#### `class_states`
Caches current state of monitored classes to detect changes.
```sql
- id (uuid, primary key)
- term (text)
- subject (text)
- catalog_nbr (text)
- class_nbr (text, unique)
- instructor_name (text)
- seats_available (integer)
- seats_capacity (integer)
- last_checked_at (timestamp)
- last_changed_at (timestamp)
```

#### `notifications_sent`
Tracks which notifications have been sent to avoid duplicates.
```sql
- id (uuid, primary key)
- class_watch_id (uuid, foreign key)
- notification_type (text) -- "seat_available" or "instructor_assigned"
- sent_at (timestamp)
```

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
