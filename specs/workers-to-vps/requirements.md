---
spec: workers-to-vps
phase: requirements
created: 2026-01-15T00:00:00Z
generated: auto
---

# Requirements: Workers to VPS Migration

## Summary

Migrate PickMyClass from Cloudflare Workers to Oracle Cloud VPS while maintaining all existing functionality, including queue-based parallel processing, circuit breaker protection, and cron-triggered class checks.

## User Stories

### US-1: Maintain Notification Reliability

As a student monitoring class sections, I want to continue receiving seat availability and instructor assignment notifications within the same timeframe as before, so that I don't miss enrollment opportunities.

**Acceptance Criteria:**
- AC-1.1: Class sections are checked every 30 minutes as before
- AC-1.2: Email notifications are sent within 5 minutes of detecting a change
- AC-1.3: No duplicate notifications are sent for the same event
- AC-1.4: Notification deduplication survives system restarts

### US-2: Application Availability

As a user, I want the PickMyClass web application to be accessible with the same response times and uptime, so that I can manage my class watches reliably.

**Acceptance Criteria:**
- AC-2.1: Web application responds to requests within 500ms (p95)
- AC-2.2: Application maintains 99.5% uptime
- AC-2.3: SSL/HTTPS is maintained with valid certificates
- AC-2.4: Authentication flow works identically to current system

### US-3: Admin Monitoring Capabilities

As an administrator, I want to monitor system health and queue status, so that I can identify and resolve issues quickly.

**Acceptance Criteria:**
- AC-3.1: Health endpoint returns database, queue, and circuit breaker status
- AC-3.2: Queue metrics (pending jobs, failed jobs, processing rate) are accessible
- AC-3.3: Circuit breaker state is visible and manually resettable
- AC-3.4: Cron job execution history is logged

### US-4: Scraper Protection

As a system, I need to protect the scraper service from overload, so that the ASU class search is not overwhelmed and our scraping continues to work.

**Acceptance Criteria:**
- AC-4.1: Circuit breaker trips after 10 consecutive failures
- AC-4.2: Circuit breaker auto-recovers after 2-minute timeout
- AC-4.3: Recovery requires 3 successful requests in half-open state
- AC-4.4: All queue workers respect circuit breaker state

## Functional Requirements

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-1 | System must process class sections in parallel via job queue | Must | US-1 |
| FR-2 | System must prevent duplicate cron executions via distributed lock | Must | US-1 |
| FR-3 | System must implement circuit breaker pattern for scraper calls | Must | US-4 |
| FR-4 | System must send batch emails via Resend API | Must | US-1 |
| FR-5 | System must persist queue jobs across restarts | Must | US-1 |
| FR-6 | System must expose health check endpoint | Should | US-3 |
| FR-7 | System must log all cron executions with timing | Should | US-3 |
| FR-8 | System must support queue job retries (max 3) | Must | US-1 |
| FR-9 | System must move failed jobs to dead letter queue | Should | US-3 |
| FR-10 | System must implement staggered checking (even/odd sections) | Should | US-1 |

## Non-Functional Requirements

| ID | Requirement | Category |
|----|-------------|----------|
| NFR-1 | System must run on Oracle Cloud free tier (1GB RAM, 1 OCPU) | Infrastructure |
| NFR-2 | System must start within 30 seconds of deployment | Performance |
| NFR-3 | System must handle 10,000+ active watches | Scalability |
| NFR-4 | Queue processing must handle 100 concurrent jobs | Scalability |
| NFR-5 | System must auto-restart on crash via PM2 | Reliability |
| NFR-6 | System must use HTTPS with auto-renewed certificates | Security |
| NFR-7 | All secrets must be stored in environment variables | Security |
| NFR-8 | System must gracefully shutdown on SIGTERM | Reliability |
| NFR-9 | Memory usage must stay under 800MB under load | Performance |
| NFR-10 | System must be deployable via single command | Operability |

## Out of Scope

- Multi-region deployment (single VPS only)
- Auto-scaling (fixed VPS capacity)
- Real-time WebSocket features (Supabase Realtime remains unchanged)
- Database migration (Supabase remains as-is)
- Scraper service changes (already on Oracle Cloud)
- User-facing feature changes

## Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| Supabase | External | PostgreSQL database, no changes required |
| Resend | External | Email service, no changes required |
| Oracle Cloud VPS | Infrastructure | Target deployment platform |
| Redis | New Dependency | Required for BullMQ queue |
| Upstash | Optional | Managed Redis alternative |
| Existing Scraper | Internal | Already on Oracle Cloud |

## Migration Constraints

1. **Zero Downtime Goal:** Use DNS switch for instant cutover, keep Cloudflare as fallback
2. **Data Continuity:** All class_watches and class_states remain in Supabase
3. **Notification State:** notifications_sent table continues working unchanged
4. **Feature Parity:** All current functionality must work post-migration
5. **Rollback Path:** DNS can switch back to Cloudflare within minutes

## Success Metrics

| Metric | Current (Cloudflare) | Target (VPS) | Measurement |
|--------|---------------------|--------------|-------------|
| Notification latency | < 5 min | < 5 min | Time from change to email |
| Cron reliability | 100% | > 99.5% | Successful cron runs |
| Application uptime | 99.9% | > 99.5% | Health check success rate |
| P95 response time | ~200ms | < 500ms | API endpoint latency |
| Queue processing rate | 100 jobs/30s | 100 jobs/30s | Jobs processed per batch |
