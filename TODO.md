# PickMyClass - TODO List

> Comprehensive task list for production readiness and feature completeness
> Generated: 2025-10-24
> Total Tasks: 100+
> **Last Updated: 2025-10-24 - Legal & Compliance COMPLETED! 🎉**

---

## ✅ RECENT COMPLETIONS

### Legal & Compliance Section - COMPLETED 2025-10-24
**All 8 tasks completed for US-only service (CCPA compliant)**
- Terms of Service, Privacy Policy with cookie disclosure
- CCPA data export/deletion APIs
- Age verification (18+) on registration
- User settings page with privacy controls
- Soft delete with 30-day retention
- Footer with legal links on all pages

**Files Created:** 13 new files, 5 modified
**Build Status:** ✅ Passing (all TypeScript & ESLint errors resolved)
**Database:** ✅ Migration applied (user_profiles table)
**Dependencies:** ✅ Installed (@radix-ui/react-tabs, @radix-ui/react-dialog)

---

## 🔴 CRITICAL PRIORITY (Security, Legal, Reliability)

### Legal & Compliance - URGENT ✅ COMPLETED (US-Only Service)
- [x] **Terms of Service page** - ✅ Created `/app/legal/terms/page.tsx` with US-only restriction, liability disclaimers, 18+ requirement
- [x] **Privacy Policy page** - ✅ Created `/app/legal/privacy/page.tsx` with CCPA compliance and cookie disclosure (merged cookie policy into this page)
- [x] ~~**Cookie Policy page**~~ - ✅ NOT NEEDED (US-only service, merged into Privacy Policy section 5)
- [x] **Data retention policy** - ✅ Documented in Privacy Policy section 6 (30-day retention for disabled accounts, 1-year for notifications)
- [x] **CCPA data export** - ✅ Added `/api/user/export` endpoint returning JSON of all user data (CCPA Right to Know)
- [x] **CCPA data deletion** - ✅ Added `/api/user/delete` endpoint with soft delete + "Delete Account" button in `/app/settings` (CCPA Right to Delete)
- [x] ~~**Cookie consent banner**~~ - ✅ NOT NEEDED (US doesn't require consent banners, only disclosure which is in Privacy Policy)
- [x] **Age verification** - ✅ Added 18+ age checkbox on registration page with Terms/Privacy agreement links

### Security Vulnerabilities
- [ ] **Rate limiting on API routes** - Prevent abuse and DoS attacks - Add `express-rate-limit` middleware to all `/api/*` routes
- [ ] **Max watches per user** - Prevent database spam (e.g., 50 watch limit) - Add check in POST `/api/class-watches` before insert
- [ ] **Password strength UI enforcement** - Weak passwords = account compromise risk - Add `zxcvbn` library to registration form with real-time strength meter
- [ ] **Account lockout after failed logins** - Prevent brute force attacks - Implement in Supabase Auth settings or custom middleware tracking failed attempts
- [ ] **Security headers middleware** - Protect against XSS, clickjacking, etc. - Add `helmet` to Next.js middleware with CSP, HSTS, X-Frame-Options
- [ ] **Session timeout management** - Limit session lifetime for security - Configure in Supabase Auth settings and add "Sessions" page to view/revoke active sessions
- [ ] **Cron endpoint authentication** - Current header check is weak - Add CRON_SECRET env var and verify in `/api/cron/route.ts` before processing
- [ ] **API request validation** - Prevent malicious payloads - Add `zod` schema validation to all API route bodies
- [ ] **SQL injection protection** - Verify Supabase client properly escapes queries - Audit all raw SQL in `hyperdrive.ts` and use parameterized queries
- [ ] **XSS prevention in emails** - Malicious class titles could inject HTML - Sanitize all class info with `DOMPurify` before rendering in email templates

### Monitoring & Alerting
- [ ] **Error tracking (Sentry)** - Know when things break in production - Add `@sentry/nextjs` and configure DSN in env vars
- [ ] **Cron job failure alerting** - Critical: silent failures = no notifications sent - Add Sentry alert or webhook to Discord/Slack when cron fails
- [ ] **Scraper service health monitoring** - Know when scraper is down - Add `/health` endpoint pinging and alert if 3+ failures
- [ ] **Dead letter queue for failed emails** - Retry failed email sends - Store failed notifications in `failed_notifications` table with retry logic
- [ ] **Structured logging** - Better debugging than console.log - Replace all `console.log` with `pino` or `winston` structured logger
- [ ] **Cloudflare Workers observability** - Get metrics on Worker performance - Enable in `wrangler.jsonc`: `"observability": { "enabled": true }`

### Email Verification & Security
- [ ] **Email verification on signup** - Prevent fake accounts and verify ownership - Enable in Supabase Auth settings and add verification flow UI
- [ ] **Email bounce handling** - Resend will flag bounces, need to handle them - Add Resend webhook endpoint to mark emails as invalid and notify user
- [ ] **Unsubscribe link in emails** - Required by CAN-SPAM Act - Add `List-Unsubscribe` header and `/unsubscribe?token=` link in email templates
- [ ] **Report spam handling** - Resend monitors spam complaints - Add webhook handler to auto-unsubscribe users who mark as spam

---

## 🟡 HIGH PRIORITY (Core UX, Features)

### User Settings & Preferences
- [ ] **User settings page** - Users need to manage their account - Create `/app/settings/page.tsx` with tabs for Profile, Notifications, Privacy
- [ ] **Notification preferences** - Users want control over email frequency - Add `user_preferences` table with `notification_enabled`, `notification_frequency` columns
- [ ] **Quiet hours setting** - Don't send emails at 3am - Add `quiet_hours_start`, `quiet_hours_end` to preferences, check in cron before sending
- [ ] **Email notification frequency** - Instant vs daily digest vs weekly - Add radio buttons in settings, implement digest cron job
- [ ] **Timezone selection** - Display times in user's timezone - Add `timezone` column, use `date-fns-tz` to format meeting times
- [ ] **Notification history page** - Users want to see what was sent - Create `/app/settings/notifications/page.tsx` querying `notifications_sent` joined with watches
- [ ] **Change email address** - Users need to update contact info - Add form in settings calling Supabase `updateUser({ email: newEmail })`
- [ ] **Delete account button** - Required for GDPR compliance - Add danger zone in settings with confirmation modal calling `/api/user/delete`

### Testing Infrastructure
- [ ] **Install Vitest** - Modern, fast test framework for Vite/Next.js - Run `bun add -D vitest @testing-library/react @testing-library/jest-dom`
- [ ] **Configure Vitest** - Set up test environment - Create `vitest.config.ts` with React testing library setup
- [ ] **Unit tests for utilities** - Test pure functions first - Write tests for `lib/utils.ts`, `lib/db/queries.ts` helper functions
- [ ] **Unit tests for email templates** - Ensure HTML renders correctly - Test `lib/email/templates/index.ts` output with snapshots
- [ ] **Integration tests for API routes** - Test full request/response cycle - Write tests for `/api/class-watches` GET/POST/DELETE using `supertest`
- [ ] **Mock Supabase in tests** - Don't hit real DB in tests - Use `@supabase/supabase-js` mock or `msw` to intercept requests
- [ ] **E2E tests with Playwright** - Test real user flows - Install Playwright, write tests for login → add watch → receive notification
- [ ] **CI/CD pipeline** - Automate testing on every commit - Create `.github/workflows/test.yml` running tests on push/PR
- [ ] **Test coverage reporting** - Know what's untested - Add `vitest --coverage` and upload to Codecov
- [ ] **Cron job logic tests** - Critical: test change detection logic - Mock old/new class states, assert notifications sent correctly

### Data Lifecycle Management
- [ ] **Cleanup old class_states** - Prevent database bloat - Add monthly cron to delete `class_states` where `last_checked_at < 6 months ago` and no active watches
- [ ] **Archive past term data** - Keep historical data but separate - Create `class_states_archive` table, move old terms there
- [ ] **Prune notifications_sent** - Don't need infinite history - Add cron to delete `notifications_sent` older than 1 year
- [ ] **Database backup strategy** - Prevent data loss - Document Supabase automatic backups and add weekly manual backup script
- [ ] **Data retention policy doc** - Transparency for users - Add to Privacy Policy: watches deleted after term ends, states kept 6 months
- [ ] **Orphaned class_states cleanup** - Remove states with zero watchers - Add weekly cron deleting class_states not referenced by any watch

### Error Handling & Recovery
- [ ] **Retry logic for scraper** - Temporary failures shouldn't lose data - Add 3 retries with exponential backoff in `fetchClassDetails()`
- [ ] **Circuit breaker for scraper** - Stop hammering failed service - Add `opossum` library to open circuit after 5 failures, retry after 1 minute
- [ ] **Graceful degradation when scraper down** - Don't break watch creation - Return cached data or partial watch without state when scraper fails
- [ ] **User-facing error messages** - Better UX than generic "Failed" - Map error codes to friendly messages in UI (e.g., "Section not found in ASU catalog")
- [ ] **Admin notification on service failure** - Know immediately when systems fail - Send email to admin when scraper/email/cron fails 3+ times
- [ ] **Failed notification retry queue** - Don't lose notifications due to transient errors - Store in `failed_notifications` table, retry hourly up to 3 times
- [ ] **Timeout for scraper requests** - Don't wait forever for slow scrapes - Add 60s timeout to fetch in POST `/api/class-watches` (already exists, good!)
- [ ] **Database connection error handling** - Graceful failure when Hyperdrive down - Wrap all DB calls in try/catch, return 503 Service Unavailable

### User Onboarding & Communication
- [ ] **Welcome email on registration** - Set expectations, guide users - Send via Resend after signup with "Getting Started" guide
- [ ] **Confirmation email for new watch** - Reassure user it was added - Send email with class details and "What happens next"
- [ ] **Watch added success feedback** - Immediate UI confirmation - Show toast with class info and "You'll be notified when seats open"
- [ ] **User guide/FAQ page** - Reduce support burden - Create `/app/help/page.tsx` with common questions and answers
- [ ] **Onboarding email series** - Educate users over time - Day 1: Welcome, Day 3: How notifications work, Day 7: Tips for success
- [ ] **Email explaining notification logic** - Transparency builds trust - Add to welcome email: "We check hourly and notify when seats: 0→1+ or instructor: Staff→Name"

---

## 🟠 MEDIUM PRIORITY (Polish, Enhancements)

### Dashboard Enhancements
- [ ] **Search/filter watches** - Find specific watch in long list - Add search input filtering by subject, catalog number, or class number
- [ ] **Bulk delete action** - Delete multiple watches at once - Add checkboxes to cards, "Delete Selected" button
- [ ] **Pause all notifications** - Temporary disable without deleting - Add toggle in settings, check `notifications_enabled` in cron
- [ ] **Sorting options** - Organize watches by preference - Add sort dropdown: Date Added, Subject, Seats Available, Alphabetical
- [ ] **Watch statistics** - Show user engagement metrics - Display "Total Watches: X, Notifications Sent: Y, Last Check: Z"
- [ ] **Export watches to CSV** - Users want backup of their data - Add "Export" button generating CSV of all watches
- [ ] **Share class watch** - Viral growth feature - Add "Share" button with copy link to pre-filled add watch form
- [ ] **Class state change history** - Show how seats changed over time - Add `class_state_history` table, chart seat availability trends
- [ ] **Duplicate watch detection** - Warn before adding same watch - Check for duplicate in UI before POST, show "Already watching" message
- [ ] **Pagination for large lists** - Performance for users with 50+ watches - Use Supabase range queries, add "Load More" button

### Notification Enhancements
- [ ] **SMS notifications** - Some users prefer texts - Integrate Twilio, add phone number field to preferences
- [ ] **Browser push notifications** - Real-time in-browser alerts - Use Web Push API with service worker
- [ ] **Discord webhook integration** - Users want notifications in Discord - Add webhook URL field in settings, POST to Discord when seat available
- [ ] **Slack webhook integration** - Professional users want Slack alerts - Same as Discord but format for Slack blocks
- [ ] **Notification delivery status** - Track if email was opened/clicked - Use Resend webhooks to update `notifications_sent` with delivery status
- [ ] **Customizable email templates** - Power users want control - Add template editor in settings using Handlebars syntax
- [ ] **Weekly digest email** - Summary of all watch activity - New cron job sending Sunday evening digest of week's changes
- [ ] **Smart notification timing** - ML to predict best send time - Track user open times, send during their active hours
- [ ] **Notification preview** - See what email looks like before enabling - Add "Send Test Email" button in settings
- [ ] **Multiple notification channels** - Email + SMS + Push simultaneously - Allow users to enable multiple channels for redundancy

### Admin Dashboard
- [ ] **Admin authentication** - Protect admin routes - Add `is_admin` column to users, check in middleware
- [ ] **Admin layout** - Separate UI for admin features - Create `/app/admin/layout.tsx` with admin navigation
- [ ] **User management page** - View all users, stats, activity - Create `/app/admin/users/page.tsx` with table and search
- [ ] **Suspend user account** - Disable abusive users - Add "Suspend" button updating `is_suspended` column
- [ ] **View all watches** - See what classes are popular - Create `/app/admin/watches/page.tsx` with aggregated stats
- [ ] **System metrics dashboard** - Health at a glance - Show total users, watches, notifications sent, error rate
- [ ] **Manual cron trigger** - Force check without waiting for schedule - Add "Run Check Now" button calling `/api/cron` with admin token
- [ ] **Global notification pause** - Emergency brake for issues - Add feature flag `notifications_globally_paused` in env/database
- [ ] **Scraper service monitoring UI** - See scraper health and logs - Create `/app/admin/scraper/page.tsx` fetching from `/health` endpoint
- [ ] **Failed job viewer** - See and retry failed operations - Query `failed_notifications` and show retry button
- [ ] **Audit log** - Track admin actions - Create `audit_log` table logging all admin operations

### API & Developer Experience
- [ ] **OpenAPI/Swagger docs** - Document API for developers - Add `swagger-ui-express` and generate from route handlers
- [ ] **API versioning** - Future-proof API changes - Prefix routes with `/api/v1/`, prepare for `/api/v2/`
- [ ] **Rate limit headers** - Tell clients their quota - Return `X-RateLimit-Limit`, `X-RateLimit-Remaining` in responses
- [ ] **API key authentication** - Allow programmatic access - Create `api_keys` table, generate keys in settings, validate in middleware
- [ ] **Webhook subscriptions** - Push notifications to user servers - Allow users to register webhook URLs for watch events
- [ ] **API client libraries** - Easier integration for developers - Generate TypeScript/Python clients from OpenAPI spec
- [ ] **GraphQL endpoint** - Flexible querying for power users - Add Apollo Server, expose watches and states as graph

### Performance Optimization
- [ ] **Redis caching layer** - Speed up repeated queries - Cache class_states in Redis with 5-minute TTL
- [ ] **Cloudflare KV for static data** - Cache terms, subjects lists - Store rarely-changing data in Workers KV
- [ ] **Database query optimization** - Faster page loads - Analyze slow queries with `EXPLAIN`, add missing indexes
- [ ] **Lazy loading on dashboard** - Don't fetch all watches immediately - Load first 10, infinite scroll for rest
- [ ] **Pagination for API responses** - Limit data transfer - Add `?page=1&limit=20` to GET `/api/class-watches`
- [ ] **Image optimization** - Faster initial load (if adding images) - Use Next.js `<Image>` component with automatic optimization
- [ ] **Code splitting** - Smaller initial bundle - Use dynamic imports for heavy components like settings
- [ ] **Prefetch class states** - Anticipate user navigation - Prefetch states when hovering over watch cards
- [ ] **Batch email sending** - Parallel sends with rate limiting - Already partially done, optimize with `Promise.allSettled()`
- [ ] **CDN configuration** - Optimize asset delivery - Configure Cloudflare caching rules for static assets

### Observability
- [ ] **Enable Workers observability** - Get built-in Cloudflare metrics - Set `"observability": { "enabled": true }` in `wrangler.jsonc`
- [ ] **Application Performance Monitoring** - Track response times, bottlenecks - Add New Relic or DataDog APM
- [ ] **User analytics** - Understand how users interact - Add Plausible (privacy-friendly) or PostHog
- [ ] **Conversion funnel tracking** - Optimize signup → add watch flow - Track events: signup, add watch, receive notification
- [ ] **A/B testing framework** - Test email subject lines, UI changes - Add `@vercel/flags` or LaunchDarkly
- [ ] **Error rate dashboard** - Visualize error trends - Create Grafana dashboard from Sentry/logs
- [ ] **Database performance metrics** - Monitor query times, connections - Use Supabase built-in metrics or pg_stat_statements

---

## 🟢 LOW PRIORITY (Nice-to-Have, Future)

### Multi-University Support
- [ ] **University abstraction layer** - Decouple from ASU-specific logic - Create `universities/` directory with interface for each school
- [ ] **University selection UI** - Let users choose their school - Add dropdown on add watch page selecting university
- [ ] **University-specific scrapers** - Each school has different catalog - Create `scraper-asu/`, `scraper-uofa/`, etc. with same interface
- [ ] **Term format mapping** - Different schools use different term codes - Add `term_format` to university config (ASU: 4 digits, others may differ)
- [ ] **Multi-university database schema** - Scale to multiple schools - Add `university` column to `class_watches` and `class_states`
- [ ] **University configuration system** - Admin adds new schools - Create admin UI to configure scraper URL, term format per university

### Advanced Features
- [ ] **Two-Factor Authentication** - Extra security for sensitive accounts - Enable TOTP in Supabase Auth, add QR code setup in settings
- [ ] **Social login (Google, GitHub)** - Faster signup, less friction - Enable OAuth providers in Supabase Auth settings
- [ ] **Dark mode toggle** - User preference vs system - Add theme switcher in header, store in localStorage
- [ ] **Mobile app (React Native)** - Native experience on phones - Create separate repo with Expo, share API
- [ ] **Browser extension** - Add watches from ASU website directly - Chrome extension injecting "Watch This Class" button on catalog pages
- [ ] **Discord bot** - Interact via Discord commands - Create bot with `/watch add 12431` commands
- [ ] **Telegram bot** - Alternative to Discord - Similar to Discord bot but for Telegram
- [ ] **Chrome notifications** - Desktop alerts when seats open - Use Chrome Push API with service worker
- [ ] **Calendar integration** - Add class to Google Calendar when enrolled - Generate .ics file or use Google Calendar API
- [ ] **Waitlist position tracking** - Track position if ASU exposes it - Scrape waitlist data, notify when position improves

### Accessibility & UX Polish
- [ ] **WCAG 2.1 AA compliance audit** - Legal requirement in some jurisdictions - Run axe DevTools, fix all violations
- [ ] **Keyboard navigation** - Users with disabilities need this - Ensure all interactive elements are keyboard accessible
- [ ] **Screen reader testing** - Blind users need proper ARIA labels - Test with NVDA/JAWS, add aria-labels where needed
- [ ] **Focus indicators** - Show which element has keyboard focus - Add visible focus rings with `:focus-visible`
- [ ] **Color contrast** - Ensure text readable for low vision - Check all text with WebAIM contrast checker (min 4.5:1)
- [ ] **Internationalization (i18n)** - Support non-English users - Add `next-i18next`, create translation files
- [ ] **Mobile responsiveness audit** - Perfect experience on all screen sizes - Test on real devices, fix all layout breaks
- [ ] **Touch target sizes** - Buttons big enough for fingers - Ensure all clickable elements minimum 44x44px
- [ ] **Reduced motion support** - Respect `prefers-reduced-motion` - Disable animations for users with vestibular disorders

### Documentation
- [ ] **User documentation** - Help users understand features - Create docs site with Docusaurus or Nextra
- [ ] **Deployment guide** - Help others self-host - Document Cloudflare Workers, Supabase, Coolify setup steps
- [ ] **Troubleshooting guide** - Common issues and fixes - Document errors and solutions (e.g., "Scraper timeout")
- [ ] **Contributing guidelines** - Welcome open-source contributions - Create `CONTRIBUTING.md` with PR process, code style
- [ ] **Architecture Decision Records** - Document why choices were made - Create `docs/adr/` with numbered ADR files
- [ ] **API changelog** - Track breaking changes - Maintain `CHANGELOG.md` with semantic versioning
- [ ] **Database schema documentation** - Explain table relationships - Generate with `dbdocs.io` or `SchemaSpy`

---

## ⚡ QUICK WINS (Can Do Today)

- [ ] **Enable Cloudflare observability** - 1 line change in `wrangler.jsonc` - Set `"enabled": true` under observability
- [ ] **Add max watches limit** - Prevent abuse - Add `if (watchCount >= 50)` check in POST route
- [ ] **Add List-Unsubscribe header** - Email compliance - Add header to Resend emails: `headers: { 'List-Unsubscribe': unsubscribeUrl }`
- [ ] **Create .env.production.example** - Document production env vars - Copy `.env.example` with production URLs
- [ ] **Add basic rate limiting** - Quick security win - Import `express-rate-limit`, add to Express app
- [ ] **Add database indexes** - Already done, verify - Check migration file has all needed indexes
- [ ] **Document backup procedures** - Write in README - Add section on Supabase Point-in-Time Recovery
- [ ] **Add error boundaries** - Catch React errors gracefully - Wrap app in `ErrorBoundary` component
- [ ] **Add loading states** - Better UX during API calls - Already partially done, ensure all async ops show loading
- [ ] **Add success toasts** - Confirm actions to user - Use `sonner` library for nice toast notifications

---

## 📈 Progress Tracking

**Total Tasks:** 114
**Completed:** 0
**In Progress:** 0
**Blocked:** 0

Last Updated: 2025-10-24

---

## 🎯 Recommended Implementation Order

**Phase 1 (Weeks 1-2): Legal & Security**
Focus on Critical issues 1-4 (Legal, Security, Monitoring, Email)

**Phase 2 (Weeks 3-4): Core UX**
Focus on High Priority issues 5-9 (Settings, Testing, Data, Errors, Onboarding)

**Phase 3 (Weeks 5-6): Polish & Admin**
Focus on Medium Priority issues 10-15 (Dashboard, Notifications, Admin, API, Performance, Observability)

**Phase 4 (Month 3+): Future Features**
Focus on Low Priority issues 16-19 (Multi-university, Advanced, Accessibility, Docs)

**Quick Wins:** Do these alongside other work for immediate impact

---

## 📝 Notes

- Priorities may shift based on user feedback
- Some tasks are interdependent (e.g., user settings → notification preferences)
- Security and legal tasks should be completed before public launch
- Testing tasks can be done incrementally alongside feature development
- Consider cost vs benefit for each task - not all need to be done

---

**Legend:**
- 🔴 Critical - Must do before launch
- 🟡 High - Significantly improves product
- 🟠 Medium - Nice polish and enhancements
- 🟢 Low - Future vision, not urgent
- ⚡ Quick Win - High impact, low effort
