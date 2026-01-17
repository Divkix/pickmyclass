---
spec: workers-to-vps
phase: research
created: 2026-01-15T00:00:00Z
generated: auto
---

# Research: Workers to VPS Migration

## Executive Summary

Migration from Cloudflare Workers to Oracle Cloud VPS is technically feasible with moderate effort. The primary challenges involve replacing Cloudflare-specific primitives (Queues, Durable Objects, Cron Triggers) with standard Node.js alternatives. The existing scraper service already runs on Oracle Cloud, demonstrating VPS viability.

## Codebase Analysis

### Existing Patterns

| File | Cloudflare Dependency | Replacement Strategy |
|------|----------------------|---------------------|
| `worker.ts` | Durable Objects (CircuitBreakerDO, CronLockDO), Queue handlers, Cron handlers | Redis for state, BullMQ for queues, node-cron |
| `app/api/cron/route.ts` | `getCloudflareContext()`, `CRON_LOCK_DO`, `CLASS_CHECK_QUEUE` | Direct Redis lock, BullMQ queue |
| `app/api/queue/process-section/route.ts` | `getCloudflareContext()`, `CIRCUIT_BREAKER_DO` | Redis-based circuit breaker |
| `app/api/monitoring/health/route.ts` | Durable Object status checks | Redis-based health checks |
| `lib/types/queue.ts` | Cloudflare Queue types | BullMQ job types |
| `wrangler.jsonc` | All Cloudflare config | Docker Compose / systemd |

### Dependencies to Remove

```
@opennextjs/cloudflare  # OpenNext Cloudflare adapter
cloudflare              # Cloudflare SDK
wrangler               # Cloudflare CLI (dev only)
```

### Dependencies to Add

```
bullmq                  # Redis-based queue (production-ready, 10K+ GitHub stars)
ioredis                 # Redis client for Node.js
node-cron               # Cron scheduling in Node.js
opossum                 # Circuit breaker pattern library
@fastify/redis          # Optional: if switching from Express to Fastify
```

### Constraints

1. **Oracle Cloud Free Tier Limits:**
   - 1GB RAM, 1 OCPU (ARM-based Ampere A1)
   - 200GB storage
   - 10TB egress/month

2. **Redis Requirement:**
   - Need Redis for BullMQ and distributed state
   - Options: Upstash (free tier), Redis on VPS, or PostgreSQL-based alternative

3. **Deployment Complexity:**
   - No auto-scaling (fixed VPS capacity)
   - Manual SSL certificate management (Let's Encrypt)
   - Process management (PM2 or systemd)

## Alternative Architectures Evaluated

### Option A: BullMQ + Redis (Recommended)

**Pros:**
- Battle-tested in production (used by companies processing millions of jobs/day)
- Feature parity with Cloudflare Queues (retries, dead letter, concurrency)
- Dashboard available (bull-board, arena)
- Works with Upstash (free tier: 10K commands/day)

**Cons:**
- Requires Redis dependency
- Memory usage concerns on 1GB VPS

### Option B: PostgreSQL-based Queue (pg-boss)

**Pros:**
- No additional infrastructure (uses existing Supabase)
- ACID transactions for job state
- Lower memory footprint

**Cons:**
- Higher database load
- Slower than Redis (disk I/O)
- Polling-based (latency)

### Option C: In-Memory Queue (Custom)

**Pros:**
- Zero dependencies
- Lowest complexity

**Cons:**
- Jobs lost on restart
- No distributed coordination
- Not suitable for 10K+ users

### Decision: Option A (BullMQ + Redis)

BullMQ provides the closest feature parity to Cloudflare Queues and is production-proven. Redis can be hosted on Upstash free tier or co-located on the VPS.

## Durable Objects Replacement Strategy

### CircuitBreakerDO -> Redis + opossum

Current implementation uses Cloudflare Durable Objects for distributed circuit breaker state. Replacement approach:

1. **State Storage:** Redis key with JSON state
2. **Atomic Operations:** Redis transactions (MULTI/EXEC)
3. **Library:** `opossum` for circuit breaker logic, custom Redis adapter

```typescript
// Redis keys
circuit:scraper:state     // { state, failureCount, successCount, lastFailure }
circuit:scraper:lock      // Distributed lock for state updates
```

### CronLockDO -> Redis Distributed Lock

Current implementation prevents concurrent cron runs. Replacement:

1. **Lock Mechanism:** Redis SET with NX and PX (expire)
2. **Auto-expiry:** 25-minute TTL (matches current implementation)
3. **Library:** `redlock` or simple Redis SET NX

```typescript
// Redis key
cron:class-check:lock    // Value: holder ID, TTL: 25 minutes
```

## Deployment Strategy

### Process Architecture on VPS

```
                    ┌─────────────────────────────────────┐
                    │           Oracle Cloud VPS          │
                    │              (ARM64)                │
                    ├─────────────────────────────────────┤
                    │  ┌─────────────┐  ┌─────────────┐  │
   HTTP (443) ──────┼─▶│   Caddy     │─▶│  Next.js    │  │
                    │  │   (Proxy)   │  │  (3000)     │  │
                    │  └─────────────┘  └─────────────┘  │
                    │                                     │
                    │  ┌─────────────┐  ┌─────────────┐  │
                    │  │   Redis     │◀─│  Queue      │  │
                    │  │   (6379)    │  │  Worker     │  │
                    │  └─────────────┘  └─────────────┘  │
                    │                                     │
                    │  ┌─────────────┐  ┌─────────────┐  │
                    │  │  node-cron  │  │  Scraper    │  │
                    │  │  (in-proc)  │  │  (3001)     │  │
                    │  └─────────────┘  └─────────────┘  │
                    └─────────────────────────────────────┘
```

### Container vs Native

| Aspect | Docker Compose | Native (PM2) |
|--------|---------------|--------------|
| Memory | Higher (~200MB overhead) | Lower |
| Isolation | Better | Minimal |
| Deployment | `docker-compose up` | `pm2 start ecosystem.config.js` |
| ARM Support | Good | Native |
| Debugging | Harder | Easier |

**Recommendation:** Native PM2 deployment due to 1GB RAM constraint.

## Feasibility Assessment

| Aspect | Assessment | Notes |
|--------|------------|-------|
| Technical Viability | High | All CF primitives have Node.js equivalents |
| Effort Estimate | M (5-7 days) | Moderate refactoring, new infrastructure |
| Risk Level | Medium | Redis dependency, single point of failure |
| Rollback Complexity | Low | Can switch DNS back to Cloudflare |

## Key Risks

1. **Memory Pressure:** Next.js + Redis + Queue workers on 1GB may require tuning
2. **No Auto-scaling:** Traffic spikes could overwhelm single VPS
3. **Redis Persistence:** Upstash or VPS Redis both have trade-offs
4. **SSL Management:** Need Caddy or manual Let's Encrypt

## Recommendations

1. **Use BullMQ + Upstash Redis** - Free tier sufficient for 10K users, no VPS memory impact
2. **Keep scraper separate** - Already on Oracle Cloud, just need internal networking
3. **Use Caddy for reverse proxy** - Automatic HTTPS, simple config
4. **Implement graceful degradation** - Queue backpressure, circuit breakers
5. **Add health checks** - For PM2 restart on failure
6. **Set up monitoring** - UptimeRobot, simple metrics endpoint
