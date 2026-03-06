# Codebase Concerns

**Analysis Date:** 2025-02-26

## Tech Debt

**Hardcoded Supabase Credentials in Middleware**
- Issue: `middleware.ts` contains hardcoded Supabase URL and anon key in plaintext
- Files: `middleware.ts` (lines 156-157)
- Impact: Credentials are committed to git history and visible in public repositories. While anon keys are rate-limited and RLS-protected, this violates security best practices and makes key rotation difficult
- Fix approach: Extract to environment variables or use `process.env.NEXT_PUBLIC_SUPABASE_URL` and `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY` consistently with `lib/supabase/client.ts`

**Inconsistent Supabase Credential Management**
- Issue: Credentials stored two ways - hardcoded in `middleware.ts` vs. environment variables in `lib/supabase/client.ts`
- Files: `middleware.ts` lines 156-157, `lib/supabase/client.ts` lines 6-8
- Impact: Maintenance burden, duplication, risk of divergence between sources
- Fix approach: Consolidate to single source - use environment variables everywhere, or create a shared config module

**Lock Release Race Condition in Cron Handler**
- Issue: `app/api/cron/route.ts` calls `getCloudflareContext()` twice - once to acquire lock (line 60) and again in finally block (line 202). Context may be stale or env bindings unavailable on second call
- Files: `app/api/cron/route.ts` (lines 60, 202-203)
- Impact: If second `getCloudflareContext()` fails, lock won't be released and will auto-expire after 25 minutes, blocking next cron run. Could cascade if cron job takes longer than expected
- Fix approach: Cache context in try block and reuse in finally block instead of calling `getCloudflareContext()` twice

**Batch Email Failure Handling is All-or-Nothing**
- Issue: `lib/email/resend.ts` lines 110-139 treats entire batch as failed if Resend API returns error, even if some emails succeeded
- Files: `lib/email/resend.ts` (lines 110-139)
- Impact: False negatives in email send results; users may not receive notifications even though some emails delivered. Rollback logic will delete legitimate sent notifications
- Fix approach: Use Resend's per-email error handling instead of treating batch failure as monolithic. Resend batch API returns per-message status that should be parsed individually

**Notification Dedup Has Unhandled Edge Case**
- Issue: `app/api/queue/process-section/route.ts` batch records notifications (line 215, 230) but if email sending partially fails and rollback fails (lines 277-282), notification records remain inconsistent
- Files: `app/api/queue/process-section/route.ts` (lines 203-283)
- Impact: Users won't be re-notified even after rollback fails. Permanent notification stuck state until manual database intervention
- Fix approach: Add retry logic for rollback failures or use database transaction to atomically record notifications only after successful email send

**Missing Error Handling for ASU API Token Expiry**
- Issue: `lib/asu/api.ts` checks for 401/403 at line 175-177, but token expiry is handled as immediate failure with no retry or circuit breaker
- Files: `lib/asu/api.ts` (lines 175-177)
- Impact: Single expired token fails all queued sections in batch. No automatic recovery mechanism. Token must be manually rotated and deployed
- Fix approach: Implement token refresh endpoint or circuit breaker pattern that fails fast and alerting system for token near-expiry

**Stagger Group Calculation May Have Off-by-One Errors**
- Issue: `app/api/cron/route.ts` lines 100-102 use `Math.floor(currentMinute / 30) % 2` to determine even/odd groups. This fails at :00 and :30 boundaries with edge case timing
- Files: `app/api/cron/route.ts` (lines 95-102)
- Impact: If cron triggers at exactly :00:00, currentMinute=0, gives 0%2=0 (even). At :30:00, currentMinute=30, gives 1%2=1 (odd). But if cron triggers at :00:59 due to scheduling delay, still classified as :00. Minor issue but causes uneven load distribution
- Fix approach: Use `new Date().getTime()` and modulo 1800000ms instead of minute-based calculation for precise stagger

## Performance Bottlenecks

**Queue Batch Processing Concurrency May Hit Resend Rate Limits**
- Problem: `worker.ts` queue handler processes up to `max_concurrency: 20` batches concurrently (line 410-453). Each batch makes internal HTTP request to queue processor. Queue processor with 5 sections per batch × 20 concurrent = 100 potential email sends in 10s window
- Files: `wrangler.jsonc` line 56, `worker.ts` lines 409-453, `lib/email/resend.ts` lines 79-146
- Cause: Resend free tier has ~40 requests/sec rate limit. With batching, 20 concurrent queue batches could spike emails to 100+ in seconds, hitting Resend limits before implementing backoff
- Improvement path: Implement exponential backoff in email batch send, track Resend rate limit headers (429 responses), or reduce max_concurrency to 5-10

**Database Queries for Watchers Not Indexed on Common Filters**
- Problem: `lib/db/queries.ts` calls RPC functions that likely scan full tables without proper indexes
- Files: `lib/db/queries.ts` (lines 26-41, 50-67, 77-116)
- Cause: Supabase RLS policies may prevent index usage. Queries on `class_watch_id` and `class_nbr` without index cause sequential scans at scale
- Improvement path: Create indexes on `class_watches(class_nbr, user_id)` and `notifications_sent(class_watch_id)`. Test index hit rates via Supabase query logs

**Lock Expiry Check Duplicated Across Methods**
- Problem: Lock expiry logic repeated in `acquireLock()` (lines 151-164), `getStatus()` (lines 251-261), and constructor (lines 99-113) in `worker.ts`
- Files: `worker.ts` (lines 72-285)
- Cause: Three independent implementations of expiry check - risk of logic divergence and maintenance burden
- Improvement path: Extract to private method `checkAndCleanExpiredLock()`, call from all three places

## Security Considerations

**CSP Headers Allow Unsafe-Inline for Scripts in Production**
- Risk: `middleware.ts` line 18 sets `script-src 'self' 'unsafe-inline'` in production CSP. Allows any inline script to execute, defeating XSS protection
- Files: `middleware.ts` (lines 16-26)
- Current mitigation: Relies on Biome linter to catch inline scripts, but not enforced at deployment
- Recommendations: Remove `'unsafe-inline'` from production CSP. Use nonce-based CSP if inline scripts required. Move to external script files. Audit current inline scripts in React components

**Admin Role Verification Only in Middleware Redirects**
- Risk: `middleware.ts` lines 241-248 redirect admin users from `/dashboard` to `/admin`, but middleware alone cannot enforce authorization. User could access `/dashboard` directly if middleware is bypassed
- Files: `middleware.ts` (lines 241-248), `app/admin/page.tsx` (line 25)
- Current mitigation: `verifyAdmin()` check in admin page components catches it, but middleware first-line check is incomplete
- Recommendations: Document that middleware redirects are convenience only. Ensure every admin route has server-side `verifyAdmin()` check. Add test to verify `verifyAdmin()` throws for non-admin users

**Failed Login Lockout Using Email as Key Without Rate Limiting Send**
- Risk: `lib/auth/lockout.ts` tracks attempts by email, but lockout mechanism doesn't prevent lockout flooding - attacker can trigger lockout for any email without rate limit
- Files: `lib/auth/lockout.ts` (lines 66-97)
- Current mitigation: 5 attempt threshold before lockout, 15-minute lockout duration
- Recommendations: Add CAPTCHA after 2-3 failed attempts (before lockout). Log lockout events for abuse detection. Implement IP-based rate limiting on login endpoint itself, not just email-based lockout

**Resend Webhook Secret Stored but Never Validated**
- Risk: `wrangler.jsonc` line 100 mentions `RESEND_WEBHOOK_SECRET` but no webhook handling code validates it
- Files: `wrangler.jsonc` (line 100)
- Current mitigation: Secret exists but is unused - provides false sense of security
- Recommendations: Either implement webhook signature verification in a `/api/webhooks/resend` route or remove unused secret to reduce confusion

**Durable Object State Not Encrypted**
- Risk: `worker.ts` CronLockDO stores lock holder ID and timestamps in plaintext in durable storage
- Files: `worker.ts` (lines 131-137)
- Current mitigation: Data is internal only, not user-facing
- Recommendations: Not critical for this use case. If extended to store sensitive data, implement encryption. For now, acceptable as internal operational state

## Fragile Areas

**CronLockDO Constructor Timing Assumptions**
- Files: `worker.ts` (lines 81-126)
- Why fragile: `blockConcurrencyWhile()` is called in constructor but state initialization is async. If a fetch request arrives before storage load completes, lock state could be inconsistent (in-memory vs stored)
- Safe modification: All lock operations already guard against this with re-checks in `acquireLock()`. To be safer, add debug logging on state divergence detection
- Test coverage: `CronLockDO` tested in isolation but not under concurrent fetch + storage load scenarios

**Queue Message Format Relies on Implicit Contracts**
- Files: `worker.ts` lines 411-422, `app/api/queue/process-section/route.ts` lines 64-66
- Why fragile: `ClassCheckMessage` type in `lib/types/queue.ts` is the contract. If a producer enqueues with different schema, consumer silently fails to destructure `class_nbr` and `term`
- Safe modification: Add schema validation in queue consumer before JSON parsing. Use Zod to validate incoming message body
- Test coverage: No test for malformed queue messages

**Email Template HTML Concatenation**
- Files: `app/api/queue/process-section/route.ts` lines 189-201 construct `ClassInfo` object, then `lib/email/resend.ts` lines 99-101 inject into HTML templates
- Why fragile: Templates likely use string concatenation or template literals - HTML injection risk if class title contains HTML-like strings (e.g., `"Intro to <script>"`)
- Safe modification: Ensure email templates use escaping library (e.g., `he` or built-in React escaping if using JSX email)
- Test coverage: No test for HTML injection in class titles

**ASU API Response Parsing Assumes Structure**
- Files: `lib/asu/api.ts` lines 185-192
- Why fragile: `mapToClassDetails()` assumes response contains `[0]._source`. If API changes structure or returns empty results, fails silently or throws unhandled error
- Safe modification: Add explicit null checks and structured error messages for each data path
- Test coverage: `tests/unit/lib/asu-api.test.ts` exists but need to verify coverage of edge cases like missing fields

**Notification Reset Does Two DB Queries Instead of One**
- Files: `lib/db/queries.ts` lines 77-116
- Why fragile: `resetNotificationsForSection()` first fetches all watch IDs (line 84-87), then deletes notifications (line 102-106). Race condition: new watch added between queries
- Safe modification: Use single RPC function that does both atomically, or use cascade delete on foreign key
- Test coverage: Not tested for race condition

## Scaling Limits

**Queue Dead Letter Queue — RESOLVED**
- DLQ consumer added in `lib/queue/dlq-consumer.ts` and wired via `worker.ts`
- Logs structured errors, looks up affected watchers, sends admin alert emails via Resend
- `max_retries: 0` on DLQ consumer prevents infinite retry loops

**Cron Lock Timeout Fixed at 25 Minutes**
- Current capacity: Cron runs every 30 minutes. Lock timeout 25 minutes (worker.ts line 76)
- Limit: If single cron job takes > 25 minutes (e.g., enqueueing 50K sections), next cron at :30 will fail to acquire lock
- Scaling path: Make timeout configurable. Monitor actual cron duration. Consider splitting cron into two smaller runs (even/odd stagger is already partial solution)

**Disposable Email Domain List Updated Once Daily**
- Current capacity: KV store holds domain list, updated at 4 AM UTC daily (wrangler.jsonc line 42)
- Limit: New disposable domains discovered between 4 AM runs won't be blocked. Spam registrations possible
- Scaling path: Increase update frequency to hourly or per-registration. Subscribe to disposable domain feed API for real-time updates

**Single ASU API Token Shared Across All Workers**
- Current capacity: Single token in env var shared across all worker isolates
- Limit: If token approaches rate limit, no fallback or rotation mechanism. Token expiry requires full deployment
- Scaling path: Implement token rotation endpoint. Store multiple tokens. Use circuit breaker to fail gracefully and alert on token issues

## Dependencies at Risk

**Resend Batch API Assumption**
- Risk: Code assumes `resend.batch.send()` returns per-message results in `data.data[].id` format (lib/email/resend.ts line 127). API contract undocumented
- Impact: If Resend changes batch API response format, email tracking breaks silently
- Migration plan: Implement fallback to sequential send if batch fails. Add Resend response schema validation with Zod

**vinext Compatibility**
- Risk: vinext is a newer Vite-based Next.js reimplementation. API surface may change between versions
- Impact: Build failures or runtime incompatibilities with newer vinext releases
- Migration plan: Monitor vinext releases. Test upgrades in staging. Document any breaking changes

**Node.js Compatibility Flag Dependency**
- Risk: `wrangler.jsonc` line 12 enables `nodejs_compat` flag. Some built-in Node modules may not work reliably in Workers
- Impact: Unexpected failures in production for modules that rely on Node.js APIs
- Migration plan: Audit dependencies for Node.js-only modules. Replace with Web API equivalents where possible. Document incompatibilities

## Test Coverage Gaps

**Queue Message Processing Not Tested End-to-End**
- What's not tested: Full flow from cron enqueue → queue consumer → database upsert → email send. Only unit tests exist
- Files: `app/api/queue/process-section/route.ts`, `lib/db/queries.ts`
- Risk: Integration failures between components won't surface until production. Specifically: race conditions in batch notification recording, partial email send rollback
- Priority: High - this is the critical path for the application

**Middleware Auth Flow Not Tested**
- What's not tested: Full auth cookie flow with token refresh, disabled account detection, email verification redirects
- Files: `middleware.ts` (150+ lines of auth logic), `tests/integration/middleware.test.ts` exists but incomplete
- Risk: Auth bypass or users stuck in redirect loops
- Priority: High - affects all authenticated users

**ASU API Error Handling Not Tested**
- What's not tested: Behavior when ASU API returns partial data, network timeouts, malformed responses
- Files: `lib/asu/api.ts`, `tests/unit/lib/asu-api.test.ts` exists but likely incomplete
- Risk: Silent failures or crashes when API changes
- Priority: Medium - affects data accuracy, not security

**Admin Routes Authorization**
- What's not tested: Non-admin users accessing `/admin/*` routes. Verify `verifyAdmin()` actually redirects or throws
- Files: `app/admin/`, `lib/auth/admin.ts`
- Risk: Unauthorized admin access if middleware or server component check is bypassed
- Priority: High - security sensitive

**Email Template Rendering**
- What's not tested: Email templates render correctly with various class info (long titles, special characters, missing fields)
- Files: `lib/email/templates*` (not provided, but referenced in resend.ts)
- Risk: Users receive broken or unstyled emails
- Priority: Medium

## Missing Critical Features

**No Circuit Breaker for External APIs**
- Problem: ASU API failures don't trigger graceful degradation or fast-fail. Queue retries with exponential backoff but no circuit breaker
- Blocks: Can't implement failover or graceful degradation when ASU API is down. User experience is delayed notifications (30+ minutes to retry)
- Recommendation: Implement Polly-style circuit breaker with half-open state for API recovery detection

**No Alerting System**
- Problem: Cron jobs, queue failures, email send failures are only logged. No alerting to operators
- Blocks: Issues go unnoticed for hours until users complain
- Recommendation: Add alerts for: DLQ accumulation, cron failures (3 consecutive failures), Resend rate limits, ASU API token expiry

**No Request Tracing Across Cron → Queue → Email**
- Problem: Request IDs not passed through system. Hard to correlate logs when a notification send fails
- Blocks: Debugging production issues requires manual log correlation across timestamps
- Recommendation: Add trace ID to cron payload, pass through queue message, include in email headers. Use structured logging

**No Data Integrity Checks**
- Problem: No periodic validation that `class_watches`, `class_states`, and `notifications_sent` stay in sync
- Blocks: Undetected orphaned records or inconsistencies can accumulate
- Recommendation: Add admin endpoint `/api/admin/integrity-check` that validates relationships and reports issues

**No User Preferences UI for Notification Types**
- Problem: Code supports `seat_available` and `instructor_assigned` notifications but users can't control which types they receive
- Blocks: Users who only want seat notifications still get instructor notifications
- Recommendation: Add settings page to enable/disable notification types per user

---

*Concerns audit: 2025-02-26*
