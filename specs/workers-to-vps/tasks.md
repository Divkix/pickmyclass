---
spec: workers-to-vps
phase: tasks
total_tasks: 24
created: 2026-01-15T00:00:00Z
generated: auto
---

# Tasks: Workers to VPS Migration

## Phase 1: Make It Work (POC)

Focus: Validate the migration works end-to-end with BullMQ and Redis. Skip tests, accept hardcoded values.

- [x] 1.1 Set up Redis client module
  - **Do**: Create `lib/redis/client.ts` with ioredis connection singleton. Support both Upstash (TLS) and local Redis. Add connection error handling.
  - **Files**: `/Users/divkix/GitHub/pickmyclass/lib/redis/client.ts`
  - **Done when**: Can import redis client and perform GET/SET operations
  - **Verify**: `bun run build` passes, no type errors
  - **Commit**: `feat(redis): add redis client singleton with upstash support`
  - _Requirements: FR-3, FR-5_
  - _Design: Redis State Store_

- [x] 1.2 Implement circuit breaker with Redis
  - **Do**: Create `lib/redis/circuit-breaker.ts` implementing CircuitBreaker class with checkState(), recordSuccess(), recordFailure(), getStatus(), reset() methods. Store state as JSON in Redis key. Match thresholds from current implementation (10 failures, 2 min timeout, 3 successes).
  - **Files**: `/Users/divkix/GitHub/pickmyclass/lib/redis/circuit-breaker.ts`
  - **Done when**: Circuit breaker transitions between CLOSED, OPEN, HALF_OPEN states correctly
  - **Verify**: Manual test with Redis CLI to verify state changes
  - **Commit**: `feat(circuit-breaker): implement redis-based circuit breaker`
  - _Requirements: FR-3, AC-4.1, AC-4.2, AC-4.3_
  - _Design: Circuit Breaker Service_

- [x] 1.3 Implement cron lock with Redis
  - **Do**: Create `lib/redis/cron-lock.ts` with acquireLock(), releaseLock(), getStatus(), forceRelease() methods. Use Redis SET NX PX for atomic lock acquisition with 25-minute TTL.
  - **Files**: `/Users/divkix/GitHub/pickmyclass/lib/redis/cron-lock.ts`
  - **Done when**: Lock can be acquired, prevents concurrent acquisition, auto-expires
  - **Verify**: Manual test acquiring lock twice shows second attempt fails
  - **Commit**: `feat(cron-lock): implement redis-based distributed lock`
  - _Requirements: FR-2_
  - _Design: Cron Lock Service_

- [x] 1.4 Set up BullMQ queue infrastructure
  - **Do**: Create `lib/queue/config.ts` with queue configuration. Create `lib/queue/queues.ts` defining class-check queue and dead letter queue. Create `lib/queue/types.ts` with job types (migrate from lib/types/queue.ts).
  - **Files**: `/Users/divkix/GitHub/pickmyclass/lib/queue/config.ts`, `/Users/divkix/GitHub/pickmyclass/lib/queue/queues.ts`, `/Users/divkix/GitHub/pickmyclass/lib/queue/types.ts`
  - **Done when**: Can enqueue jobs to class-check queue via helper function
  - **Verify**: `bun run build` passes, queue exists in Redis
  - **Commit**: `feat(queue): add bullmq queue infrastructure`
  - _Requirements: FR-1, FR-8, FR-9_
  - _Design: BullMQ Queue System_

- [x] 1.5 Implement queue worker
  - **Do**: Create `lib/queue/worker.ts` with BullMQ Worker that processes class-check jobs. Port logic from `app/api/queue/process-section/route.ts`: fetch old state, call scraper with circuit breaker, detect changes, send emails, update state. Configure concurrency (4 workers).
  - **Files**: `/Users/divkix/GitHub/pickmyclass/lib/queue/worker.ts`
  - **Done when**: Worker processes jobs from queue and logs results
  - **Verify**: Enqueue test job, verify processing in logs
  - **Commit**: `feat(queue): implement bullmq worker for section processing`
  - _Requirements: FR-1, FR-3, FR-8, AC-4.4_
  - _Design: Queue Worker Flow_

- [x] 1.6 Implement node-cron scheduler
  - **Do**: Create `lib/cron/scheduler.ts` with node-cron setup. Create `lib/cron/class-check.ts` with cron handler logic (port from app/api/cron/route.ts): acquire lock, fetch sections, enqueue to BullMQ, release lock. Schedule for "0,30 * * * *".
  - **Files**: `/Users/divkix/GitHub/pickmyclass/lib/cron/scheduler.ts`, `/Users/divkix/GitHub/pickmyclass/lib/cron/class-check.ts`
  - **Done when**: Cron fires at :00 and :30, enqueues sections
  - **Verify**: Trigger cron manually, check jobs in queue
  - **Commit**: `feat(cron): add node-cron scheduler for class checks`
  - _Requirements: FR-1, FR-2, FR-10, AC-1.1_
  - _Design: Cron Scheduler_

- [x] 1.7 Create application entry point
  - **Do**: Create `server.ts` that starts Next.js server, initializes Redis, starts cron scheduler, starts queue workers. Handle graceful shutdown on SIGTERM/SIGINT.
  - **Files**: `/Users/divkix/GitHub/pickmyclass/server.ts`
  - **Done when**: `bun server.ts` starts all services
  - **Verify**: Server starts, cron logs, worker logs visible
  - **Commit**: `feat(server): add unified server entry point`
  - _Requirements: NFR-5, NFR-8_
  - _Design: Process Architecture_

- [x] 1.8 Update health endpoint for Redis
  - **Do**: Modify `app/api/monitoring/health/route.ts` to check Redis connection, queue metrics (via BullMQ Queue.getJobCounts()), circuit breaker status (via Redis), cron lock status. Remove all Cloudflare-specific code.
  - **Files**: `/Users/divkix/GitHub/pickmyclass/app/api/monitoring/health/route.ts`
  - **Done when**: Health endpoint returns Redis-based status
  - **Verify**: `curl localhost:3000/api/monitoring/health` returns queue metrics
  - **Commit**: `refactor(health): use redis for status checks`
  - _Requirements: FR-6, AC-3.1, AC-3.2, AC-3.3_
  - _Design: Health Endpoint_

- [x] 1.9 POC Checkpoint
  - **Do**: Run full flow: start server, wait for cron trigger, verify sections enqueued, verify worker processes jobs, verify notifications sent (or mock). Test with 1-2 real class watches.
  - **Done when**: End-to-end notification flow works on local machine
  - **Verify**: Check email received or logs show email sent
  - **Commit**: `feat(migration): complete POC for vps deployment`

## Phase 2: Refactoring

After POC validated, clean up code and remove Cloudflare dependencies.

- [x] 2.1 Remove Cloudflare-specific files
  - **Do**: Delete `worker.ts`, `wrangler.jsonc`, `lib/cloudflare-env.d.ts`, `lib/types/queue.ts` (replaced by lib/queue/types.ts). Delete `app/api/queue/process-section/route.ts` (logic moved to worker).
  - **Files**: Delete above files
  - **Done when**: No Cloudflare-specific files remain
  - **Verify**: `bun run build` passes
  - **Commit**: `refactor(cleanup): remove cloudflare-specific files`
  - _Design: File Structure_

- [x] 2.2 Update cron API route
  - **Do**: Modify `app/api/cron/route.ts` to be a thin wrapper that calls the shared cron handler. Keep authentication check. Remove getCloudflareContext() and Durable Object calls.
  - **Files**: `/Users/divkix/GitHub/pickmyclass/app/api/cron/route.ts`
  - **Done when**: Cron route delegates to lib/cron/class-check.ts
  - **Verify**: `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron` triggers job
  - **Commit**: `refactor(cron): use shared cron handler in api route`
  - _Design: Data Flow_

- [x] 2.3 Update package.json dependencies
  - **Do**: Remove `@opennextjs/cloudflare`, `cloudflare`, `wrangler`. Add `bullmq`, `ioredis`, `node-cron`. Update scripts: remove preview/deploy/cf-typegen, add `start:prod`.
  - **Files**: `/Users/divkix/GitHub/pickmyclass/package.json`
  - **Done when**: `bun install` succeeds with new deps
  - **Verify**: No Cloudflare packages in node_modules (after fresh install)
  - **Commit**: `chore(deps): remove cloudflare deps, add bullmq and redis`
  - _Design: Dependencies_

- [x] 2.4 Add error handling and logging
  - **Do**: Add try/catch to worker, cron, and Redis modules. Add structured logging with timestamps. Ensure all errors are caught and logged.
  - **Files**: All lib/queue/*, lib/redis/*, lib/cron/* files
  - **Done when**: No unhandled promise rejections, errors logged with context
  - **Verify**: Trigger error conditions, verify logs
  - **Commit**: `refactor(error-handling): add structured error handling and logging`
  - _Design: Error Handling_

- [x] 2.5 Add graceful shutdown
  - **Do**: In server.ts, handle SIGTERM/SIGINT: stop cron scheduler, close queue workers (wait for current jobs), close Redis connection, then exit.
  - **Files**: `/Users/divkix/GitHub/pickmyclass/server.ts`
  - **Done when**: Server shuts down cleanly on Ctrl+C
  - **Verify**: Send SIGTERM, verify logs show graceful shutdown
  - **Commit**: `refactor(server): implement graceful shutdown`
  - _Requirements: NFR-8_
  - _Design: Process Architecture_

## Phase 3: Testing

- [x] 3.1 Unit tests for circuit breaker
  - **Do**: Create `lib/redis/__tests__/circuit-breaker.test.ts`. Test state transitions, threshold behavior, auto-recovery timing. Mock Redis.
  - **Files**: `/Users/divkix/GitHub/pickmyclass/lib/redis/__tests__/circuit-breaker.test.ts`
  - **Done when**: Tests cover all state transitions
  - **Verify**: `bun run test circuit-breaker`
  - **Commit**: `test(circuit-breaker): add unit tests for state transitions`
  - _Requirements: AC-4.1, AC-4.2, AC-4.3_

- [ ] 3.2 Unit tests for cron lock
  - **Do**: Create `lib/redis/__tests__/cron-lock.test.ts`. Test lock acquisition, rejection, expiry, release. Mock Redis.
  - **Files**: `/Users/divkix/GitHub/pickmyclass/lib/redis/__tests__/cron-lock.test.ts`
  - **Done when**: Tests cover all lock scenarios
  - **Verify**: `bun run test cron-lock`
  - **Commit**: `test(cron-lock): add unit tests for distributed lock`
  - _Requirements: FR-2_

- [ ] 3.3 Integration tests for queue worker
  - **Do**: Create `lib/queue/__tests__/worker.integration.test.ts`. Test job processing with real Redis (use test container or Upstash). Mock scraper and email.
  - **Files**: `/Users/divkix/GitHub/pickmyclass/lib/queue/__tests__/worker.integration.test.ts`
  - **Done when**: Worker processes test jobs correctly
  - **Verify**: `bun run test worker.integration`
  - **Commit**: `test(queue): add integration tests for worker`
  - _Requirements: FR-1, FR-8_

- [ ] 3.4 End-to-end cron test
  - **Do**: Create `e2e/cron-flow.test.ts`. Test full flow: trigger cron, verify queue jobs created, verify worker processes them. Use test database entries.
  - **Files**: `/Users/divkix/GitHub/pickmyclass/e2e/cron-flow.test.ts`
  - **Done when**: E2E test passes
  - **Verify**: `bun run test:e2e`
  - **Commit**: `test(e2e): add cron flow integration test`
  - _Requirements: AC-1.1, AC-1.2_

## Phase 4: Quality Gates

- [ ] 4.1 Create PM2 ecosystem config
  - **Do**: Create `ecosystem.config.js` with app config: name, script (server.ts), instances (1 due to RAM), env vars, log paths, restart policy.
  - **Files**: `/Users/divkix/GitHub/pickmyclass/ecosystem.config.js`
  - **Done when**: `pm2 start ecosystem.config.js` runs application
  - **Verify**: PM2 shows app running
  - **Commit**: `chore(pm2): add ecosystem configuration`
  - _Requirements: NFR-5, NFR-10_
  - _Design: Process Manager_

- [ ] 4.2 Create Caddyfile
  - **Do**: Create `Caddyfile` with domain config, reverse proxy to localhost:3000, gzip encoding, access logging.
  - **Files**: `/Users/divkix/GitHub/pickmyclass/Caddyfile`
  - **Done when**: Caddy config is valid
  - **Verify**: `caddy validate --config Caddyfile`
  - **Commit**: `chore(caddy): add reverse proxy configuration`
  - _Requirements: NFR-6_
  - _Design: Caddy Reverse Proxy_

- [ ] 4.3 Create deployment script
  - **Do**: Create `scripts/deploy.sh` that: pulls latest code, installs deps, builds Next.js, restarts PM2. Create `scripts/setup-vps.sh` for initial VPS setup (install Node, Redis, Caddy, PM2).
  - **Files**: `/Users/divkix/GitHub/pickmyclass/scripts/deploy.sh`, `/Users/divkix/GitHub/pickmyclass/scripts/setup-vps.sh`
  - **Done when**: Scripts are executable and documented
  - **Verify**: Scripts run without syntax errors
  - **Commit**: `chore(deploy): add deployment and setup scripts`
  - _Requirements: NFR-10_
  - _Design: Migration Strategy_

- [ ] 4.4 Run local quality checks
  - **Do**: Run `bun run lint`, `bun run format:check`, `bun run knip`, `bun run build`, `bun run test:run`. Fix any issues.
  - **Verify**: All commands pass with no errors
  - **Done when**: Zero lint errors, build succeeds, tests pass
  - **Commit**: `fix(lint): address lint and type issues` (if needed)

- [ ] 4.5 Update CLAUDE.md documentation
  - **Do**: Update CLAUDE.md to reflect new architecture: remove Cloudflare references, add Redis/BullMQ info, update deployment commands, add PM2 commands.
  - **Files**: `/Users/divkix/GitHub/pickmyclass/CLAUDE.md`
  - **Done when**: Documentation reflects VPS deployment
  - **Verify**: Read through for accuracy
  - **Commit**: `docs(claude): update for vps deployment`
  - _Design: Documentation_

- [ ] 4.6 Create PR and verify CI
  - **Do**: Push branch, create PR with summary of migration. Verify CI passes (lint, types, tests, build).
  - **Verify**: `gh pr checks --watch` shows all green
  - **Done when**: PR ready for review, CI passing
  - **Commit**: N/A (PR creation)

## Notes

- **POC shortcuts taken**:
  - Hardcoded Redis connection in some places
  - Minimal error messages
  - No retry backoff tuning
  - Single worker instance for testing

- **Production TODOs for Phase 2**:
  - Environment-based Redis configuration
  - Structured logging with levels
  - Proper connection pooling
  - Memory usage monitoring
  - Rate limiting for API routes

- **VPS Deployment Checklist** (after PR merged):
  - [ ] Provision Oracle Cloud A1 instance
  - [ ] Run setup-vps.sh
  - [ ] Configure environment variables
  - [ ] Set up Upstash Redis or local Redis
  - [ ] Configure Caddy with domain
  - [ ] Run deploy.sh
  - [ ] Verify health endpoint
  - [ ] Update DNS
  - [ ] Monitor for 24 hours
