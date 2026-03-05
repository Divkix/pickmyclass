# Codebase Structure

**Analysis Date:** 2026-02-26

## Directory Layout

```
project-root/
├── app/                          # App Router directory
│   ├── (public)/                 # Landing page and legal
│   │   ├── page.tsx              # Homepage
│   │   ├── layout.tsx            # Root layout with providers
│   │   └── legal/                # /legal/privacy, /legal/terms
│   ├── admin/                    # Admin-only pages
│   │   ├── layout.tsx            # Admin layout with nav
│   │   ├── page.tsx              # Admin dashboard
│   │   ├── classes/              # /admin/classes, /admin/classes/[classNbr]
│   │   └── users/                # /admin/users, /admin/users/[userId]
│   ├── auth/                     # Auth pages
│   │   ├── login/                # /login with form
│   │   ├── register/             # /register with form
│   │   ├── forgot-password/      # Password reset request
│   │   ├── reset-password/       # Password reset with token
│   │   ├── verify-email/         # Email verification prompt
│   │   └── callback/             # OAuth callback handler
│   ├── dashboard/                # User dashboard (authenticated)
│   │   ├── page.tsx              # List of watched classes
│   │   ├── add/                  # /dashboard/add - add class form
│   │   └── layout.tsx            # Dashboard layout with nav
│   ├── settings/                 # /settings - user preferences
│   ├── go/[uni]/                 # Redirect page for mobile shortcuts
│   ├── api/                      # API routes (route handlers)
│   │   ├── auth/                 # Authentication endpoints
│   │   │   ├── login/            # POST /api/auth/login
│   │   │   ├── register/         # POST /api/auth/register
│   │   │   ├── signout/          # POST /api/auth/signout
│   │   │   └── check-lockout/    # GET /api/auth/check-lockout
│   │   ├── class-watches/        # GET/POST /api/class-watches
│   │   ├── fetch-class-details/  # GET /api/fetch-class-details?class_nbr=X
│   │   ├── cron/                 # Cron job endpoints
│   │   │   ├── route.ts          # GET /api/cron (main cron)
│   │   │   └── update-disposable-domains/  # GET /api/cron/update-disposable-domains
│   │   ├── queue/                # Queue consumer endpoints
│   │   │   └── process-section/  # POST /api/queue/process-section
│   │   ├── user/                 # User management endpoints
│   │   │   ├── delete/           # DELETE /api/user/delete
│   │   │   └── export/           # GET /api/user/export
│   │   ├── monitoring/           # Health checks
│   │   │   └── health/           # GET /api/monitoring/health
│   │   ├── webhooks/             # Third-party webhooks
│   │   │   └── resend/           # POST /api/webhooks/resend (email events)
│   │   └── unsubscribe/          # GET /api/unsubscribe?token=X
│   ├── globals.css               # Tailwind CSS global styles
│   └── layout.tsx                # Root layout
├── components/                   # React components
│   ├── ui/                       # shadcn/ui base components
│   │   ├── button.tsx            # Button
│   │   ├── card.tsx              # Card
│   │   ├── input.tsx             # Input
│   │   ├── dialog.tsx            # Dialog modal
│   │   ├── tabs.tsx              # Tabs
│   │   ├── table.tsx             # Table
│   │   ├── badge.tsx             # Badge
│   │   ├── alert.tsx             # Alert
│   │   ├── label.tsx             # Form label
│   │   ├── select.tsx            # Select dropdown
│   │   └── skeleton.tsx          # Loading skeleton
│   ├── landing/                  # Landing page components
│   │   ├── HeroSection.tsx       # Hero banner
│   │   ├── FeaturesSection.tsx   # Features grid
│   │   ├── HowItWorks.tsx        # Step-by-step guide
│   │   ├── DashboardPreview.tsx  # Screenshot preview
│   │   ├── SocialProofBanner.tsx # User count, testimonials
│   │   ├── MobileStickyCTA.tsx   # Sticky CTA for mobile
│   │   ├── AuthRedirect.tsx      # Redirect authenticated users
│   │   └── JsonLd.tsx            # Structured data (JSON-LD)
│   ├── admin/                    # Admin-specific components
│   │   ├── ClassTable.tsx        # (inferred) List of classes
│   │   └── UserTable.tsx         # (inferred) List of users
│   ├── AddClassWatch.tsx         # Form to add class watch
│   ├── ClassWatchCard.tsx        # Card showing watched class
│   ├── ClassDetailsDialog.tsx    # Modal showing class details
│   ├── ClassStateIndicator.tsx   # Visual indicator of seat availability
│   ├── DeleteAccountModal.tsx    # Account deletion confirmation
│   ├── DeleteConfirmDialog.tsx   # Generic delete confirmation
│   ├── AuthButton.tsx            # Login/logout button
│   ├── Header.tsx                # Top navigation bar
│   ├── Footer.tsx                # Footer
│   ├── Logo.tsx                  # Logo component
│   ├── ThemeToggle.tsx           # Dark/light mode toggle
│   ├── BottomNav.tsx             # Mobile bottom navigation
│   ├── BottomNavWrapper.tsx      # Wrapper with safe area
│   └── PullToRefreshIndicator.tsx # Pull-to-refresh animation
├── lib/                          # Shared libraries and utilities
│   ├── supabase/                 # Supabase client configurations
│   │   ├── client.ts             # Browser client (anon key)
│   │   ├── server.ts             # Server component client (cookie auth)
│   │   ├── service.ts            # Service role client (RLS bypass)
│   │   ├── database.types.ts     # Generated TypeScript types
│   │   └── database.types.supplemental.ts  # Manual type augmentations
│   ├── db/                       # Database query helpers
│   │   ├── queries.ts            # User-facing DB operations
│   │   └── admin-queries.ts      # Admin-specific queries
│   ├── asu/                      # ASU Class Search API integration
│   │   └── api.ts                # ASU API client with error classes
│   ├── email/                    # Email service integration
│   │   ├── resend.ts             # Resend batch email client
│   │   ├── unsubscribe-token.ts  # Generate signed unsubscribe tokens
│   │   └── templates/            # Email HTML templates
│   │       └── index.ts          # SeatAvailableEmailTemplate, InstructorAssignedEmailTemplate
│   ├── auth/                     # Authentication utilities
│   │   ├── lockout.ts            # Failed login attempt tracking
│   │   ├── disposable-email.ts   # Check for disposable email domains
│   │   └── admin.ts              # Admin role checking
│   ├── hooks/                    # Custom React hooks (client-side)
│   │   ├── usePullToRefresh.ts   # Pull-to-refresh on mobile
│   │   ├── useRealtimeClassStates.ts  # Supabase Realtime subscriptions
│   │   └── useSwipe.ts           # Swipe gesture detection
│   ├── contexts/                 # React Context providers
│   │   ├── AuthContext.tsx       # User auth state
│   │   └── ThemeContext.tsx      # Dark/light theme
│   ├── types/                    # TypeScript type definitions
│   │   └── queue.ts              # Cloudflare Queue message types
│   ├── utils/                    # Utility functions
│   │   ├── utils.ts              # General helpers (cn, formatters, etc)
│   │   ├── crypto.ts             # Cryptographic helpers (timingSafeCompare)
│   │   └── ratemyprofessor.ts    # RateMyProfessor integration
│   ├── cloudflare-env.d.ts       # Generated Cloudflare env bindings
│   ├── cloudflare-env.supplemental.d.ts  # Manual env augmentations
│   └── animations.ts             # Framer Motion animation presets
├── worker.ts                     # Custom Cloudflare Worker entrypoint
│   │                             # - Wraps vinext handler
│   │                             # - Implements scheduled (cron) handler
│   │                             # - Implements queue consumer handler
│   │                             # - Exports CronLockDO Durable Object
├── middleware.ts                 # Middleware (request interception)
│   │                             # - Auth enforcement
│   │                             # - Security headers
│   │                             # - Admin routing
├── tests/                        # Test suites (NOT colocated)
│   ├── unit/                     # Unit tests
│   │   ├── lib/                  # Library tests
│   │   │   ├── utils.test.ts
│   │   │   ├── lockout.test.ts
│   │   │   ├── animations.test.ts
│   │   │   ├── ratemyprofessor.test.ts
│   │   │   ├── disposable-email.test.ts
│   │   │   ├── asu-api.test.ts
│   │   │   └── unsubscribe-token.test.ts
│   │   └── hooks/                # Hook tests
│   │       └── useSwipe.test.ts
│   └── integration/              # Integration tests
│       ├── middleware.test.ts    # Auth flow
│       └── api/                  # API route tests
│           ├── register.test.ts
│           ├── login.test.ts
│           ├── class-watches.test.ts
│           └── update-disposable-domains.test.ts
├── supabase/                     # Supabase schema and migrations
│   ├── migrations/               # PostgreSQL migration files
│   │   ├── 20240101000000_initial_schema.sql
│   │   ├── 20240102000000_rls_policies.sql
│   │   ├── 20240103000000_functions.sql
│   │   └── ...
│   └── config.toml               # Supabase CLI config
├── public/                       # Static assets
│   ├── favicon.svg
│   ├── apple-touch-icon.png
│   ├── og-image.png
│   └── robots.txt
├── scripts/                      # Build and utility scripts
│   └── generate-og-image.ts      # OG image generation
├── .github/                      # GitHub configuration
│   └── workflows/                # CI/CD workflows
│       └── ci.yml                # Quality checks, tests, build
├── .planning/                    # Planning documents (generated by GSD)
│   └── codebase/                 # Architecture and structure docs
│       ├── ARCHITECTURE.md
│       ├── STRUCTURE.md
│       ├── CONVENTIONS.md
│       ├── TESTING.md
│       ├── STACK.md
│       ├── INTEGRATIONS.md
│       └── CONCERNS.md
├── wrangler.jsonc                # Cloudflare Workers config
├── tsconfig.json                 # TypeScript config (app)
├── tsconfig.worker.json          # TypeScript config (worker.ts)
├── vitest.config.ts              # Vitest test runner config
├── biome.json                    # Biome linter/formatter config
├── tailwind.config.ts            # Tailwind CSS config
├── next.config.ts                # vinext config
├── package.json                  # Dependencies and scripts
├── bun.lock                      # Bun lockfile
├── CLAUDE.md                     # Project-specific Claude instructions
└── CONTRIBUTING.md               # Contribution guidelines
```

## Directory Purposes

**app/:**
- Purpose: App Router - pages, layouts, API routes
- Contains: React components, route handlers, middleware-related exports
- Key files: `layout.tsx` (root), `page.tsx` per route, `route.ts` for APIs

**components/:**
- Purpose: Reusable React components (UI kit, pages, features)
- Contains: Presentational components, no business logic mixing
- Key files: shadcn/ui base components, feature-specific components

**lib/:**
- Purpose: Shared business logic, integrations, utilities
- Contains: Database queries, API clients, authentication, hooks, contexts
- Key files: Organized by concern (supabase, asu, email, auth, hooks)

**worker.ts:**
- Purpose: Custom Cloudflare Worker runtime entrypoint
- Contains: Scheduled handler (cron), queue handler (batch processor), Durable Objects
- Key exports: `CronLockDO`, `scheduled`, `queue`, `fetch` handlers

**middleware.ts:**
- Purpose: Request-level auth, security, routing
- Contains: Auth checks, security headers, admin redirects
- Execution: Runs before every HTTP request to app/

**tests/:**
- Purpose: Test suites (NOT colocated with source)
- Contains: Unit tests (lib/, hooks/) and integration tests (API routes, middleware)
- Run: `bun run test` or `bun run test:coverage`

**supabase/:**
- Purpose: Database schema, migrations, RLS policies
- Contains: PostgreSQL migration SQL files, functions, triggers
- Manage: `bunx supabase migration new <name>` to create, `bunx supabase db push`

**public/:**
- Purpose: Static assets served at root
- Contains: Favicon, OG images, robots.txt, manifests
- Deployment: Served via Cloudflare Cache

**.planning/codebase/:**
- Purpose: GSD mapping documents (architecture, conventions, testing patterns)
- Contents: Generated by `/gsd:map-codebase` command, consumed by other GSD commands
- Never edit manually; regenerate with GSD when structure changes

## Key File Locations

**Entry Points:**

- `app/page.tsx` - Landing page (/) - public
- `app/dashboard/page.tsx` - User dashboard (/dashboard) - authenticated
- `app/admin/page.tsx` - Admin console (/admin) - admin only
- `worker.ts` - Cloudflare Worker entrypoint - processes cron, queue, fetch
- `app/api/cron/route.ts` - Cron job trigger (via worker.ts scheduled handler)
- `app/api/queue/process-section/route.ts` - Queue consumer (via worker.ts queue handler)

**Configuration:**

- `wrangler.jsonc` - Cloudflare Worker bindings, cron triggers, queue config
- `tsconfig.json` - TypeScript config for app code
- `tsconfig.worker.json` - TypeScript config for worker.ts (separate because different environment)
- `biome.json` - Linting and formatting rules (biome check ., biome format .)
- `vitest.config.ts` - Test runner configuration
- `tailwind.config.ts` - Tailwind CSS customization

**Core Logic:**

- `lib/db/queries.ts` - Database operations (getClassWatchers, getSectionsToCheck, etc.)
- `lib/db/admin-queries.ts` - Admin-only database operations
- `lib/supabase/service.ts` - Service role client (RLS bypass for cron/queue)
- `lib/supabase/client.ts` - Browser client (respects RLS)
- `lib/supabase/server.ts` - Server component/route handler client (cookie auth)
- `lib/asu/api.ts` - ASU Class Search API client (error classes, fetch logic)
- `lib/email/resend.ts` - Resend batch email client
- `lib/auth/lockout.ts` - Failed login attempt tracking
- `lib/auth/disposable-email.ts` - Disposable email domain list

**Testing:**

- `tests/unit/lib/` - Unit tests for library code
- `tests/unit/hooks/` - Unit tests for React hooks
- `tests/integration/api/` - Integration tests for API routes
- `tests/integration/middleware.test.ts` - Middleware auth flow tests

## Naming Conventions

**Files:**

- **React components** (`.tsx`): PascalCase
  - Example: `ClassWatchCard.tsx`, `AddClassWatch.tsx`
  - Exception: Context providers can be lowercase: `themes.tsx`

- **Utilities and non-component code** (`.ts`): camelCase or descriptive
  - Example: `utils.ts`, `crypto.ts`, `ratemyprofessor.ts`

- **API routes** (`route.ts`): Named `route.ts` in directory matching endpoint
  - Example: `app/api/class-watches/route.ts` → `POST /api/class-watches`

- **Test files**: Match source file, add `.test.ts` suffix
  - Example: `lib/utils.ts` → `tests/unit/lib/utils.test.ts`

- **Database migrations**: Timestamp + description
  - Example: `20240101000000_initial_schema.sql`

**Directories:**

- **Feature directories** (camelCase): `dashboard`, `admin`, `settings`
- **API route groups** (lowercase): `api/auth`, `api/cron`, `api/queue`
- **Utility groupings** (camelCase): `lib/supabase`, `lib/asu`, `lib/email`
- **Component collections** (camelCase): `components/landing`, `components/admin`

**Functions and Variables:**

- **Exports from lib/** - camelCase
  - Example: `getClassWatchers()`, `getSectionsToCheck()`, `tryRecordNotifications()`

- **React hooks** - useXxx pattern (camelCase)
  - Example: `useAuth()`, `usePullToRefresh()`, `useRealtimeClassStates()`

- **Constants** - UPPER_SNAKE_CASE for module-level, camelCase for local
  - Module-level: `const LOCK_TIMEOUT_MS = 25 * 60 * 1000`
  - Local: `const maxWatches = 10`

## Where to Add New Code

**New User-Facing Feature:**
1. Pages: `app/[path]/page.tsx`
2. Components: `components/[FeatureName].tsx`
3. API routes: `app/api/[endpoint]/route.ts`
4. Hooks (if client-side state): `lib/hooks/use[FeatureName].ts`
5. Tests: `tests/integration/api/[endpoint].test.ts` or `tests/unit/hooks/use[FeatureName].test.ts`

**New Background Job (Cron/Queue Task):**
1. API route: `app/api/cron/[jobName]/route.ts` or `app/api/queue/[processor]/route.ts`
2. Query helper: `lib/db/queries.ts` (add function)
3. Logic: Extract to `lib/[domain]/[module].ts` if complex
4. Tests: `tests/integration/api/[jobName].test.ts`

**New External Integration:**
1. Client: `lib/[service]/[module].ts` (e.g., `lib/email/resend.ts`)
2. Types: `lib/types/[service].ts` if complex types needed
3. Error handling: Define custom error classes in the client
4. Tests: `tests/unit/lib/[module].test.ts`

**New Database Operation:**
1. Query function: `lib/db/queries.ts` (user-facing) or `lib/db/admin-queries.ts` (admin-only)
2. Migration: `supabase/migrations/[timestamp]_[description].sql`
3. Generate types: `bunx supabase gen types typescript --linked > lib/supabase/database.types.ts`
4. Tests: `tests/integration/api/[related-route].test.ts`

**New UI Component:**
1. Base components: `components/ui/[component].tsx` (from shadcn/ui)
2. Feature components: `components/[Feature].tsx` (domain-specific)
3. Landing page: `components/landing/[Section].tsx`
4. Admin components: `components/admin/[Component].tsx`

**New Utility or Helper:**
1. Location: `lib/utils/[category].ts` or directly in `lib/utils.ts`
2. Export: Named export for tree-shaking
3. Tests: `tests/unit/lib/[category].test.ts`

## Special Directories

**supabase/migrations/:**
- Purpose: PostgreSQL schema versioning
- Generated: Manually created via `bunx supabase migration new <name>`
- Committed: Yes (tracks schema changes)
- Pattern: Each file is a complete migration with up/down SQL

**tests/:**
- Purpose: Separated from source (not colocated)
- Generated: No (manually written following TDD)
- Committed: Yes
- Run: `bun run test` (watch), `bun run test:run` (once), `bun run test:coverage` (with V8)

**.next/ and dist/:**
- Purpose: Build artifacts (vinext for Workers)
- Generated: Yes (during `bun run build` and `bun run preview`)
- Committed: No (.gitignore)
- Regenerate: `rm -rf .next dist && bun run preview`

**coverage/:**
- Purpose: Test coverage reports (V8)
- Generated: Yes (during `bun run test:coverage`)
- Committed: No (.gitignore)
- View: Open `coverage/index.html` in browser

**.wrangler/:**
- Purpose: Local Cloudflare Worker state
- Generated: Yes (by wrangler CLI during preview/deploy)
- Committed: No (.gitignore)

---

*Structure analysis: 2026-02-26*
