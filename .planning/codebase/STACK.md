# Technology Stack

**Analysis Date:** 2026-02-26

## Languages

**Primary:**
- TypeScript 5.9.3 - All application code, type-safe backend and frontend
- JavaScript/JSX - React components with JSX syntax (via TypeScript)

**Secondary:**
- SQL - Database schema and migrations (PostgreSQL via Supabase)

## Runtime

**Environment:**
- Node.js - Application runs on Cloudflare Workers (Node.js compatibility mode enabled)
- Bun - Package manager and development runtime

**Package Manager:**
- Bun - Primary package manager for dev and runtime dependency management
- Lockfile: `bun.lock` (committed, frozen lockfile used in CI)

## Frameworks

**Core:**
- Next.js 16.1.6 - Full-stack React framework with API routes and App Router
- React 19.2.4 - UI components and state management
- Tailwind CSS 4.2.0 - Utility-first CSS framework with PostCSS 4 support

**Frontend UI:**
- Radix UI (@radix-ui/react-*) - Headless components: dialog, label, select, slot, tabs
- shadcn/ui (via components.json) - Pre-built accessible component library
- Lucide React 0.574.0 - Icon library
- Framer Motion 12.34.2 - Animation library
- Sonner 2.0.7 - Toast notification library
- next-themes 0.4.6 - Dark/light mode theme management

**Testing:**
- Vitest 4.0.18 - Unit test runner with v8 coverage provider
- @testing-library/react 16.3.2 - Component testing utilities
- @testing-library/jest-dom 6.9.1 - DOM matchers for Vitest
- jsdom 28.1.0 - DOM implementation for server-side testing

**Build/Dev:**
- @opennextjs/cloudflare 1.16.5 - Next.js adapter for Cloudflare Workers
- Wrangler 4.66.0 - Cloudflare Workers CLI and dev server
- Biome 2.4.2 - Linting, formatting, and organizing imports
- Knip 5.84.1 - Dead code and unused dependency detection
- TypeScript 5.9.3 - Type checking and compilation

**Database:**
- @supabase/supabase-js 2.97.0 - PostgreSQL client with auth integration
- @supabase/ssr 0.8.0 - Server-side rendering helpers for Supabase auth
- Supabase CLI 2.76.10 (dev dependency) - Database migration and schema management

**Styling:**
- @tailwindcss/postcss 4.2.0 - PostCSS plugin for Tailwind CSS 4
- tailwind-merge 3.5.0 - Merge Tailwind class conflicts
- class-variance-authority 0.7.1 - Component variant patterns
- clsx 2.1.1 - Conditional class name joining

**Utilities:**
- Zod 4.3.6 - Runtime schema validation and type inference
- Resend 6.9.2 - Email service API client

**Image Generation:**
- satori 0.19.2 - React to SVG converter for OG images
- @resvg/resvg-js 2.6.2 - SVG to PNG renderer

## Key Dependencies

**Critical:**
- @supabase/supabase-js - PostgreSQL database and authentication
- @opennextjs/cloudflare - Bridges Next.js to Cloudflare Workers runtime
- Wrangler - Builds and deploys to Cloudflare infrastructure
- Zod - Runtime type validation for API request/response contracts

**Infrastructure:**
- Resend - Email service for class notifications
- Framer Motion - Animation for UI state transitions
- next-themes - Theme persistence across page reloads

## Configuration

**Environment:**
- **Variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NOTIFICATION_FROM_EMAIL`, `NEXT_PUBLIC_SITE_URL`, `MAX_WATCHES_PER_USER`
- **Secrets:** `SUPABASE_SERVICE_ROLE_KEY`, `ASU_API_BASE_URL`, `ASU_API_TOKEN`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `CRON_SECRET`
- **Location:** Set via `wrangler secret put` or Cloudflare Dashboard; also in `wrangler.jsonc` `vars` section

**Build:**
- `next.config.ts` - Next.js build configuration (standalone output for Workers)
- `tsconfig.json` - Main TypeScript configuration (excludes `worker.ts`)
- `tsconfig.worker.json` - Worker-only TypeScript configuration for `worker.ts`
- `postcss.config.mjs` - PostCSS plugins (@tailwindcss/postcss)
- `biome.json` - Linting, formatting, and import organization rules (80-char line width for code, 120 for CSS)
- `vitest.config.ts` - Unit test configuration with jsdom environment and v8 coverage
- `open-next.config.ts` - OpenNext configuration for Cloudflare deployment
- `wrangler.jsonc` - Cloudflare Workers configuration: cron triggers (0,30 * * * *), queues, Durable Objects, KV, observability

**Compatibility:**
- `nodejs_compat` flag - Enables Node.js APIs in Cloudflare Workers
- `global_fetch_strictly_public` flag - Allow fetch to public URLs only

## Platform Requirements

**Development:**
- Bun 1.0+ (uses setup-bun GitHub Action)
- Node.js types and compatibility

**Production:**
- Cloudflare Workers deployment platform
- PostgreSQL 13+ (via Supabase)
- Email service (Resend)
- ASU Class Search API access

**Deployment Pipeline:**
- Cloudflare Workers with OpenNext
- Durable Objects for distributed state (cron locking)
- Cloudflare Queues (class-check-queue, dead letter queue class-check-dlq)
- Cloudflare KV (DISPOSABLE_DOMAINS_KV for email validation)
- Cron triggers every 30 minutes
- Observability enabled with full log persistence

---

*Stack analysis: 2026-02-26*
