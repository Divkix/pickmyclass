# Migration Plan: Puppeteer Scraper → Direct ASU API

## The Discovery

ASU's catalog data is available via a REST API endpoint. Returns structured JSON in ~300ms. No browser needed.

**The endpoint, auth token, and query parameters are stored as Cloudflare secrets — not in source code.** This is an open-source project; exposing the API details publicly would invite abuse and risk the endpoint getting locked down.

### Cloudflare Secrets (already configured)

| Secret | Purpose |
|--------|---------|
| `ASU_API_BASE_URL` | Base URL for the catalog API |
| `ASU_API_TOKEN` | Authorization header value |

These replace `SCRAPER_URL` and `SCRAPER_SECRET_TOKEN`.

---

## Impact Summary

| Metric | Before (Puppeteer) | After (Direct API) |
|--------|--------------------|---------------------|
| Response time per section | 15-30 seconds | ~300ms |
| RAM per request | ~150MB (Chromium) | ~15-30 MB (Workers isolate) |
| Infrastructure | Oracle Cloud VM + Docker + Puppeteer | None (runs in Workers) |
| Data quality | HTML scraping (fragile) | Structured JSON (robust) |
| 5,000 sections end-to-end | Hours | ~90-120 seconds (with consumer ramp-up) |
| Lines of code | ~1,500 lines in scraper/ | ~120 lines in lib/asu/api.ts |

> **Note:** The previous estimate of "~35 seconds" assumed instant consumer scaling and zero failures. Realistic timing includes Cloudflare Queue consumer ramp-up (~30-60s to reach full concurrency), scheduling overhead, and a 5% failure/retry budget. Still a 100x improvement over Puppeteer.

---

## Phase 0: Pre-Flight Verification (BEFORE ANY CODE CHANGES)

**This phase is mandatory. Do not skip it.**

### 0a. Verify ASU API Secrets

Write a small test script (or use `wrangler dev` locally) to:

1. Read `ASU_API_BASE_URL` and `ASU_API_TOKEN` from environment
2. Make a test API call for 5+ known section numbers across different types:
   - A normal lecture section
   - An online/iCourse section
   - A section with "Staff" instructor
   - A section with multiple meeting patterns (e.g., MW lecture + F lab)
   - A cancelled or restricted section (0 capacity)
3. Validate the response structure matches the expected field mapping

### 0b. Compare Field Formats Against Existing Data

For each test section, compare the API response against the corresponding row in `class_states`:

| Field | Check |
|-------|-------|
| `INSTRUCTORS[0].NAME` | Does format match `instructor_name` in DB? (e.g., "Last, First" vs "First Last") |
| Days + `STARTTIME`-`ENDTIME` | Does composed string match `meeting_times` in DB? (e.g., "MW 9:00 AM-10:15 AM") |
| `FACILITYID` | Does it match `location` in DB? (e.g., "MUR201" vs "MURN0201") |
| `ENRLCAP - ENRLTOT` | Matches `seats_available`? Check overenrolled sections (ENRLTOT > ENRLCAP). |

**If any format differs, build a normalization function in `lib/asu/api.ts`.** Format mismatches will trigger false `last_changed_at` updates via DB triggers for every affected section.

### 0c. Neutralize `non_reserved_seats` Transition

**CRITICAL:** The API does not return `non_reserved_seats`. Setting it to `null` is correct, but the *transition* from an existing numeric value to `null` will trigger false notifications.

`getOpenSeats(0, 5)` returns `0`. But `getOpenSeats(null, 5)` returns `5` (`null ?? 5 = 5`). For any section where the scraper stored `non_reserved_seats = 0` and `seats_available > 0`, the first cron run triggers a false "seat available" email.

**Run this SQL before the first post-migration cron run:**

```sql
UPDATE public.class_states SET non_reserved_seats = NULL;
```

This makes `oldState.non_reserved_seats` null too, so both old and new use the fallback path. No false notifications.

---

## Phase 1: Create ASU API Client

**Action:** Create `lib/asu/api.ts`

Single module that replaces the entire scraper service. Reads `ASU_API_BASE_URL` and `ASU_API_TOKEN` from environment (Cloudflare secrets). No hardcoded URLs or tokens in source code.

```typescript
// Pseudocode — actual URLs/tokens come from env
const baseUrl = process.env.ASU_API_BASE_URL;
const token = process.env.ASU_API_TOKEN;

const response = await fetch(`${baseUrl}/search/classes?...`, {
  headers: { Authorization: token },
  signal: AbortSignal.timeout(10_000), // 10s timeout — see Reliability section
});
```

### Field Mapping (API Response → Our Types)

| API Response Field | Our Field | Notes |
|--------------------|-----------|-------|
| `ENRLCAP - ENRLTOT` | `seats_available` | `Math.max(0, (ENRLCAP ?? 0) - (ENRLTOT ?? 0))` — handles null and overenrolled |
| `ENRLCAP` | `seats_capacity` | `ENRLCAP ?? 0` |
| `SUBJECT` | `subject` | Direct mapping |
| `CATALOGNBR` | `catalog_nbr` | Direct mapping |
| `COURSETITLELONG` | `title` | Use long title, fallback to `TITLE` |
| `INSTRUCTORS[0].NAME` | `instructor` | **Safe access:** `response.INSTRUCTORS?.[0]?.NAME \|\| 'Staff'` |
| `FACILITYID` | `location` | Verify format matches scraper output in Phase 0 |
| Days + `STARTTIME`-`ENDTIME` | `meeting_times` | Compose from `MON/TUES/WED/THURS/FRI` + times. **Take first pattern only** for multi-pattern sections. Match scraper format exactly. |
| `CLASSNBR` | `class_nbr` | For validation |
| `WAITTOT` | (new, optional) | Waitlist count — bonus data we never had |
| `WAITCAP` | (new, optional) | Waitlist capacity — bonus data |
| *(not available)* | `non_reserved_seats` | Always `null` |

### Error Handling (Status-Code-Aware)

The API client must distinguish between error types:

```typescript
// In lib/asu/api.ts
if (response.status === 401 || response.status === 403) {
  throw new AuthError('ASU API token expired or invalid');  // Non-retryable
}
if (response.status === 429) {
  throw new RateLimitError('ASU API rate limit hit');       // Retry with long delay
}
if (response.status === 404 || results.length === 0) {
  throw new NotFoundError(`Section ${class_nbr} not found`); // Non-retryable
}
if (!response.ok) {
  throw new ApiError(`ASU API returned ${response.status}`);  // Retryable
}
```

### `non_reserved_seats` Handling

The API doesn't return reserved seat breakdowns. Set to `null`. The codebase handles this via `getOpenSeats()` in `process-section/route.ts:213-218` which falls back: `nonReserved ?? totalAvailable`.

**The transition is safe ONLY if Phase 0c (DB migration) is run first.** Without it, sections with `non_reserved_seats = 0` will trigger false "seat available" notifications.

### UI Impact of `non_reserved_seats = null`

This is a **permanent change** to the user experience:

- `ClassStateIndicator.tsx:31-43` — All classes show yellow `HelpCircle` "unknown" icon instead of green `CheckCircle`
- `ClassStateIndicator.tsx:85-90` — Warning badge: "Reserved seat status unknown - verify before enrolling"
- `templates/index.ts:151-171` — Every notification email shows yellow warning box about reserved seats

**Decision needed:** Either accept the degraded UI, or refactor these components to treat `null` as normal (remove warnings/yellow states) since `non_reserved_seats` will *always* be null going forward.

---

## Phase 2: Modify Queue Consumer

**Action:** Edit `app/api/queue/process-section/route.ts`

### What changes:

1. **Delete** `fetchClassDetailsWithCircuitBreaker()` function (lines 46-110) — replaced by ASU API client
2. **Delete** `ScraperResponse` interface (lines 23-37) — replaced by API client's return type
3. **Delete** CircuitBreakerDO interaction (lines 155-172) — no longer needed
4. **Import** new `lib/asu/api.ts` client
5. **Replace** scraper call with direct API call
6. **Add** error-type-aware handling for non-retryable errors (auth, not-found)

### What stays unchanged:

- Authentication check (lines 119-146) — still uses `CRON_SECRET`
- Change detection logic (lines 209-243) — works as-is with same field names
- Notification pipeline (lines 250-396) — untouched
- DB upsert to `class_states` (lines 399-417) — same columns, same data shape

### Before:
```typescript
const scraperResponse = await fetchClassDetailsWithCircuitBreaker(class_nbr, term, circuitBreakerStub);
if (!scraperResponse.success || !scraperResponse.data) { ... }
const newData = scraperResponse.data;
```

### After:
```typescript
const newData = await fetchClassFromASU(class_nbr, term);
// Returns same shape: { subject, catalog_nbr, title, instructor, seats_available, seats_capacity, non_reserved_seats, location, meeting_times }
```

---

## Phase 3: Modify Frontend Class Fetch

**Action:** Edit `app/api/fetch-class-details/route.ts`

### What changes:

1. **Delete** scraper URL/token check (lines 77-79)
2. **Delete** `ScraperResponse` interface (lines 39-53) — duplicate
3. **Delete** stub data fallback (lines 167-177) — no longer needed since API always works
4. **Replace** scraper fetch (lines 80-106) with ASU API client call
5. **Keep** DB upsert to `class_states` (lines 111-144) — still useful for immediate dashboard display

---

## Phase 3b: Modify Class Watches Endpoint

**Action:** Edit `app/api/class-watches/route.ts`

> **This file was missing from the original plan. It contains a full scraper call that MUST be migrated.**

### What changes:

1. **Delete** `ScraperResponse` interface (lines 27-41)
2. **Delete** `SCRAPER_URL` / `SCRAPER_SECRET_TOKEN` env var reads (lines 182-183)
3. **Delete** scraper HTTP call (lines 189-229)
4. **Delete** development fallback stub logic (lines 230-235)
5. **Replace** with ASU API client call
6. **Update** tests in `tests/integration/api/class-watches.test.ts` (lines 306-330)

**If this file is not updated and scraper vars are removed, the POST handler for adding new watches silently returns fake "CSE 240" stub data for every new watch in production.**

---

## Phase 4: Replace CircuitBreakerDO with Lightweight Alternative

**Action:** Edit `worker.ts`

> **Revised from original plan.** The original plan deleted CircuitBreakerDO entirely, calling it "overkill for a simple `fetch()`." This is wrong — the circuit breaker coordinates 250 independent Workers against a single upstream. The problem doesn't change because the call is faster.
>
> Without any coordination, a cascading failure means 250 consumers × 10 batch × 3 retries = **7,500 wasted API calls** before the system gives up. With zero retry delay configured, these happen in seconds.

### Option A: Lightweight Fail Counter DO (Recommended, ~50 lines)

Replace the full CircuitBreakerDO state machine with a simple counter:
- Workers check: "have >N requests failed in the last M seconds?"
- If yes, skip the API call and let the message retry later
- No HALF_OPEN state, no success thresholds — just a fail counter with TTL

### Option B: Keep CircuitBreakerDO as-is

Already works, battle-tested. ~240 lines is not unreasonable for production reliability at this scale.

### Option C: Per-invocation retry with backoff (minimum viable)

No distributed coordination. Each invocation handles its own retries with exponential backoff. Simpler but doesn't prevent the thundering herd — 250 invocations still independently hammer a dead API.

### Deletions regardless of option:

- `CircuitState` enum (lines 47-51) — replace or simplify
- `CircuitBreakerState` interface (lines 56-62) — replace or simplify
- `SCRAPER_URL` and `SCRAPER_SECRET_TOKEN` from `Env` interface (lines 31-32)

### Keep:

- `CronLockDO` — still prevents duplicate cron runs
- Queue handler — same logic, just calls a faster endpoint now
- Scheduled handler — unchanged

---

## Phase 5: Update Health Monitoring

**Action:** Edit `app/api/monitoring/health/route.ts`

### What changes:

1. **Remove** circuit breaker health check (lines 72-119)
2. **Remove** `SCRAPER_URL` and `SCRAPER_SECRET_TOKEN` from `requiredEnvVars` array (lines 167-168)
3. **Add** `ASU_API_BASE_URL` and `ASU_API_TOKEN` to `requiredEnvVars`
4. **Add** ASU API health check — hit the API with a known section number, verify 200 response with expected fields. This replaces the circuit breaker health signal.

### Keep:

- Database health check
- CronLockDO status check
- Email service check
- Environment configuration check (updated vars list)

---

## Phase 6: Update Type Definitions

**Action:** Edit `lib/types/queue.ts`

### Removals from `Env` interface:

```typescript
// DELETE these:
SCRAPER_URL: string;
SCRAPER_SECRET_TOKEN: string;
CIRCUIT_BREAKER_DO: DurableObjectNamespace;  // Keep if using lightweight DO replacement
SCRAPER_BATCH_SIZE?: string;
```

### Additions to `Env` interface:

```typescript
// ADD these:
ASU_API_BASE_URL: string;
ASU_API_TOKEN: string;
```

**After editing `wrangler.jsonc` (Phase 7), run `bun run cf-typegen`** to regenerate `lib/cloudflare-env.d.ts`. The generated types file has references to `CircuitBreakerDO`, `SCRAPER_URL`, `SCRAPER_SECRET_TOKEN`, and `SCRAPER_BATCH_SIZE` that must be updated.

---

## Phase 7: Update Wrangler Config

**Action:** Edit `wrangler.jsonc`

### Remove from `vars` section:

```jsonc
// DELETE these lines (hardcoded scraper config):
"SCRAPER_BATCH_SIZE": "3",
"SCRAPER_URL": "https://pickmyclass-scraper.divkix.me/"
```

**Do NOT add `ASU_API_BASE_URL` or `ASU_API_TOKEN` to `vars`.** They are Cloudflare encrypted secrets set via the dashboard — never committed to the repo.

### CircuitBreakerDO binding:

**Stage 1 deploy:** Keep the DO binding but point to an empty stub class. This preserves rollback capability.

**Stage 3 deploy (after verification):** Remove binding and add deletion migration. See Deployment Strategy below.

### Add queue reliability config:

```jsonc
// ADD to consumer config:
"max_concurrency": 20,     // Cap concurrent consumers (default 250 is too aggressive)
"retry_delay": 60           // 60 second delay between retries (default is 0 = immediate)
```

### Keep batch size conservative:

```jsonc
// Keep batch_size at 5 (not 10 as originally proposed).
// The natural backpressure from Puppeteer's slowness is gone.
// Start conservative, increase after monitoring shows ASU API handles the load.
"max_batch_size": 5,
"max_batch_timeout": 10    // Reduced from 30 — faster batch delivery
```

> **Why not batch_size 10:** With `max_concurrency: 20` and `batch_size: 10`, peak concurrent API calls = 20 × 10 = 200. With `batch_size: 5`, peak = 20 × 5 = 100. Start at 100, validate ASU doesn't rate-limit, then consider increasing.

---

## Phase 8: Delete Scraper Service

**Action:** Delete entire `scraper/` directory

```
scraper/
├── .dockerignore
├── .env.example
├── .gitignore
├── bun.lock
├── debug-page.js
├── dist/
├── docker-compose.yml
├── Dockerfile
├── node_modules/
├── package.json
├── README.md
├── src/
│   ├── index.ts          # Express server
│   ├── scraper.ts        # Puppeteer scraper + BrowserPool
│   └── ...
├── test-scraper.js
└── tsconfig.json
```

All of this is replaced by ~120 lines in `lib/asu/api.ts`.

---

## Phase 9: Stale Reference Cleanup

**Action:** Update files with leftover scraper/CircuitBreakerDO references not covered by other phases.

| File | What to change |
|------|---------------|
| `lib/cloudflare-env.d.ts` | Regenerate via `bun run cf-typegen` after wrangler.jsonc changes |
| `tests/integration/api/class-watches.test.ts` | Update `vi.stubEnv('SCRAPER_URL', ...)` test cases |
| `app/admin/page.tsx:178` | Change "Scraper service status" text to "ASU API status" |
| `knip.json:27` | Remove `"scraper/**"` from ignore list |
| `.cfignore:4-5,11` | Remove `scraper/`, `test-scraper.js` rules |
| `vitest.config.ts:12,20` | Remove `scraper` from exclude |
| `tsconfig.json:39` | Remove `scraper` from exclude |
| `.github/dependabot.yml:48-61,74-76` | Remove scraper service dependabot config |
| `README.md:146-147,161,197` | Update SCRAPER_URL/SCRAPER_SECRET_TOKEN references |
| `CLAUDE.md:82-85,136` | Update CircuitBreakerDO and scraper references |
| `components/ClassStateIndicator.tsx:32` | Change "scraper failure" comment to "API failure" |

---

## Deployment Strategy (Staged — Rollback-Safe)

> **CRITICAL CHANGE from original plan.** The original plan deployed everything at once including the irreversible DO deletion. Per [Cloudflare docs](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/): "Rollbacks will not be allowed if a Durable Object migration has occurred." A bad field mapping + irreversible deploy = no way back.

### Stage 0: Pre-Flight (before any deploy)

- [ ] Verify ASU API secrets work: test fetch for 5+ known sections (Phase 0a)
- [ ] Compare all field formats against `class_states` rows (Phase 0b)
- [ ] Run `UPDATE class_states SET non_reserved_seats = NULL;` (Phase 0c)
- [ ] Build normalization functions if any field formats differ

### Stage 1: Code-Only Deploy (ROLLBACK-SAFE)

**Deploy at `:05` or `:35`** (5 minutes after cron trigger to avoid race conditions).

- [ ] All code changes from Phases 1-7
- [ ] **Include `app/api/class-watches/route.ts`** (Phase 3b)
- [ ] **Keep CircuitBreakerDO as empty stub class** in `worker.ts` (export minimal class extending DurableObject)
- [ ] **Keep the DO binding in `wrangler.jsonc`** — no `deleted_classes` migration yet
- [ ] Regenerate types: `bun run cf-typegen`
- [ ] Run `biome check` and `bunx knip`
- [ ] Deploy: `bun run deploy`

**Verify:**
1. Hit health endpoint: `GET /api/monitoring/health`
2. Add a test class watch — verify real data (not CSE 240 stub)
3. Check Cloudflare Workers logs for successful queue processing
4. Wait for next cron run — check for ~300ms processing times
5. **Monitor email send rates — watch for any false notification spike**

**Keep Oracle Cloud scraper running** as unused safety net (costs nothing).

**At any point during Stage 1, you can rollback via `wrangler rollback`.**

### Stage 2: Monitoring Period (24-48 hours)

- [ ] Monitor queue error rates + DLQ
- [ ] Monitor email send rates — compare against baseline
- [ ] Confirm zero scraper calls in Cloudflare logs
- [ ] Verify no false notifications were sent
- [ ] **Can still `wrangler rollback` at any point**

### Stage 3: DO Cleanup Deploy (POINT OF NO RETURN)

**Only proceed after Stage 2 verification passes.**

- [ ] Remove CircuitBreakerDO stub class from `worker.ts`
- [ ] Remove DO binding from `wrangler.jsonc`
- [ ] Add v3 `deleted_classes: ["CircuitBreakerDO"]` migration
- [ ] Deploy: `bun run deploy`
- [ ] **After this, NO ROLLBACK is possible.**
- [ ] Delete `SCRAPER_SECRET_TOKEN` from Cloudflare secrets dashboard

### Stage 4: Infrastructure Decommission

- [ ] Stop scraper Docker container on Oracle Cloud
- [ ] Remove the Oracle Cloud instance (or repurpose)
- [ ] Remove DNS record: `pickmyclass-scraper.divkix.me`
- [ ] Run stale reference cleanup (Phase 9)

---

## Reliability Architecture (Post-Migration)

### Retry Strategy

| HTTP Status from ASU | Action | Retry? |
|---------------------|--------|--------|
| `200` | Process normally | N/A |
| `401` / `403` | Log auth error, `message.ack()` | **No** — token problem, alert operator |
| `404` / empty results | Section doesn't exist, `message.ack()` | **No** — permanent |
| `429` | Rate limited, `message.retry({ delaySeconds: 120 })` | Yes, long delay |
| `5xx` | Server error, `message.retry({ delaySeconds: Math.pow(2, attempts) * 30 })` | Yes, exponential backoff |
| Timeout (>10s) | Network issue, `message.retry()` | Yes, standard delay |

### Concurrency Limits

| Config | Value | Rationale |
|--------|-------|-----------|
| `max_concurrency` | 20 | Caps concurrent consumers. 20 × 5 batch = 100 peak concurrent API calls. |
| `max_batch_size` | 5 | Conservative start. Each batch = ~1.5s wall-clock. |
| `max_batch_timeout` | 10 | Faster batch delivery than 30s default. |
| `max_retries` | 3 | Unchanged. |
| `retry_delay` | 60 | 60s between retries. Prevents retry storms. |

### Key Numbers

| Metric | Value |
|--------|-------|
| Cloudflare Workers CPU time limit (queue) | 15 min |
| Workers memory per isolate | 128 MB |
| Workers subrequests per invocation | 10,000 |
| Workers concurrent outbound connections | 6 per invocation |
| Queue max consumer concurrency | 250 (we cap at 20) |
| ASU API rate limit | **Unknown** — no public docs |

---

## What Does NOT Change

These files/systems are completely untouched:

| File/System | Why unchanged |
|-------------|---------------|
| `app/api/cron/route.ts` | Enqueues sections — doesn't call scraper |
| `lib/db/queries.ts` | All DB queries use same field names |
| `lib/email/resend.ts` | `ClassInfo` interface already matches |
| `lib/email/templates/index.ts` | Uses `ClassInfo` — same shape (but see UI impact note in Phase 1) |
| `CronLockDO` in `worker.ts` | Still prevents duplicate crons |
| Queue architecture | Still uses Cloudflare Queues for parallelism |
| Supabase schema | No column migrations needed |
| `middleware.ts` | No scraper references |
| Dashboard components | Read from `class_states` — same schema |
| `components/AddClassWatch.tsx` | Calls `/api/fetch-class-details` — same response shape |

---

## Files Changed Summary

| File | Action | LOC Impact |
|------|--------|------------|
| `lib/asu/api.ts` | **CREATE** | +~120 |
| `app/api/queue/process-section/route.ts` | **EDIT** | -~70, +~15 |
| `app/api/fetch-class-details/route.ts` | **EDIT** | -~100, +~20 |
| `app/api/class-watches/route.ts` | **EDIT** | -~60, +~15 |
| `worker.ts` | **EDIT** | -~240, +~50 (lightweight DO) |
| `app/api/monitoring/health/route.ts` | **EDIT** | -~50, +~20 |
| `lib/types/queue.ts` | **EDIT** | -~4, +~2 |
| `wrangler.jsonc` | **EDIT** | -~8, +~6 |
| `lib/cloudflare-env.d.ts` | **REGENERATE** | auto |
| `tests/integration/api/class-watches.test.ts` | **EDIT** | ~10 |
| `scraper/` (entire directory) | **DELETE** | -~1,000+ |
| Various stale references (Phase 9) | **EDIT** | ~20 |

**Net: ~1,500 lines deleted, ~260 lines added.**

---

## Rollback Plan

### Before Stage 3 (DO deletion):

Full rollback available via `wrangler rollback`. Takes seconds. All scraper code is in git history. Oracle Cloud scraper still running as fallback.

### After Stage 3 (DO deletion):

Rollback is blocked by Cloudflare. Recovery options:

1. **Forward-fix** — patch the issue in the current codebase and redeploy
2. **Recreate CircuitBreakerDO** — add a v4 `new_classes` migration, restore the class, redeploy. Hours of work.
3. **Redeploy scraper** — restore `scraper/` from git, redeploy Oracle Cloud VM, re-add Cloudflare secrets. Hours of work.

### For API outages (regardless of stage):

1. Queue consumer returns 500 for failed fetches
2. Cloudflare Queue retries with 60s delay (`retry_delay: 60`)
3. Exponential backoff on 5xx errors
4. Dead letter queue (`class-check-dlq`) catches persistent failures after 3 retries
5. No data corruption — failed fetches just don't update `class_states`
6. Auth errors (401/403) are acked immediately — don't waste retries

---

## Security Notes

- **No API URLs, tokens, or endpoint details are committed to the repo.** Everything is in Cloudflare encrypted secrets.
- The `.env.example` uses generic placeholders only:
  ```
  ASU_API_BASE_URL=https://example.com/api
  ASU_API_TOKEN=your-token-here
  ```
- Contributors running locally need to obtain their own API credentials.
- The `wrangler.jsonc` `vars` section contains NO API secrets — only non-sensitive app config like `MAX_WATCHES_PER_USER` and `NOTIFICATION_FROM_EMAIL`.

---

## Risk Register

| # | Risk | Severity | Status |
|---|------|----------|--------|
| 1 | `non_reserved_seats` transition triggers false notifications | CRITICAL | Mitigated by Phase 0c DB migration |
| 2 | `class-watches/route.ts` missed — fake data in production | CRITICAL | Mitigated by adding Phase 3b |
| 3 | DO deletion blocks all rollbacks | CRITICAL | Mitigated by staged deploy strategy |
| 4 | Instructor name format mismatch | CRITICAL | Mitigated by Phase 0b format verification |
| 5 | Retry storm (no backoff) | HIGH | Mitigated by `retry_delay: 60` + exponential backoff |
| 6 | ASU API rate limiting (unknown limits) | HIGH | Mitigated by `max_concurrency: 20` + conservative batch size |
| 7 | No distributed failure coordination | HIGH | Mitigated by lightweight fail-counter DO |
| 8 | Monitoring blind spots | HIGH | Mitigated by ASU API health check in monitoring endpoint |
| 9 | ASU secrets unverified | HIGH | Mitigated by Phase 0a pre-flight verification |
| 10 | Permanent UI degradation (yellow warnings) | HIGH | Decision needed: accept or refactor UI components |
| 11 | Meeting times format mismatch | HIGH | Mitigated by Phase 0b format comparison |
| 12 | 12+ files with stale references | MEDIUM | Addressed in Phase 9 |
| 13 | Timeout not configured | MEDIUM | Set `AbortSignal.timeout(10_000)` |
| 14 | Auth token rotation undetected | MEDIUM | Status-code-aware error handling |
| 15 | ENRLCAP/ENRLTOT null or negative | MEDIUM | `Math.max(0, ...)` with null coalescing |
| 16 | Cron race during deploy | MEDIUM | Deploy at :05 or :35 |
| 17 | "35s" estimate misleading | LOW | Corrected to 90-120s in Impact Summary |
