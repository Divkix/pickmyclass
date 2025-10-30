# PickMyClass Scraper Service v2.0.0

Production-grade Puppeteer scraper service for extracting ASU class details with circuit breaker protection, request queuing, health monitoring, and auto-recovery.

## Architecture

This service runs as a standalone Express server that:
- Accepts authenticated POST requests with section numbers and terms
- Uses Puppeteer to scrape ASU's class search website (React SPA)
- Returns parsed class details (seats, instructor, location, etc.)
- Protects against abuse with rate limiting and bearer token auth
- Maintains a browser pool for performance (~5-10s vs ~15-20s per request)

**Production-grade features (v2.0.0):**
- ✅ **Circuit Breaker**: Fails fast when ASU site is down (10 failures → 2 min cooldown)
- ✅ **Request Queue**: Limits concurrent scrapes (max 10) to prevent overload
- ✅ **Health Monitoring**: Auto-detects memory leaks and stuck browsers
- ✅ **Metrics Endpoint**: Comprehensive real-time monitoring data
- ✅ **Auto-Recovery**: Graceful error handling with guaranteed resource cleanup
- ✅ **Memory Leak Fixes**: Pages always closed even on errors

### Browser Pool Implementation (v2.0.0)
- **Pool Size**: 3 browser instances (reduced from 10 for stability)
- **Memory Usage**: ~450MB for browsers + ~1.5GB headroom = 2GB Docker limit
- **Connection Reuse**: Reuses browsers to avoid ~3-5 second launch overhead
- **Graceful Shutdown**: Handles SIGINT/SIGTERM to properly close browsers
- **Race Condition Handling**: Prevents multiple simultaneous browser launches
- **Resource Cleanup**: Guaranteed page.close() and browser release (even on errors)

### React SPA Handling
ASU's class search is a React Single Page Application that:
1. Loads an empty HTML shell (`<div id="root"></div>`)
2. Loads React bundle (~500KB of JavaScript)
3. Makes API calls to fetch class data
4. Renders results dynamically into a `<table>` element

We handle this by:
- Waiting for `networkidle2` (React bundle + API calls complete)
- Adding 2-second delay for React rendering
- Searching all tables for one with valid class data
- Using heuristics (5-digit section number) to identify correct table

## Setup

### 1. Install Dependencies

```bash
cd scraper
bun install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set:

**Required:**
- `SECRET_TOKEN`: Generate with `openssl rand -hex 32`
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Set to `production` when deploying

**Optional (v2.0.0 features):**
- `MAX_CONCURRENT_BROWSERS`: Browser pool size (default: 3, range: 1-5)
- `MAX_CONCURRENT_REQUESTS`: Max concurrent scrapes (default: 10, range: 5-20)
- `CIRCUIT_BREAKER_THRESHOLD`: Failures before opening circuit (default: 10)
- `CIRCUIT_BREAKER_TIMEOUT`: Cooldown time in ms (default: 120000 = 2 minutes)

### 3. Run Development Server

```bash
bun run dev
```

Server starts at `http://localhost:3000`

## API Endpoints

### Health Check (Enhanced in v2.0.0)
```bash
GET /health
```

Public endpoint for Docker healthcheck and monitoring. Returns **200 OK** if healthy, **503 Service Unavailable** if unhealthy.

**Healthy Response (200):**
```json
{
  "status": "healthy",
  "service": "pickmyclass-scraper",
  "version": "2.0.0",
  "timestamp": "2025-10-30T10:30:00.000Z",
  "uptime": 3600,
  "checks": {
    "browserPool": true,
    "circuitBreaker": true,
    "memory": true,
    "queue": true
  },
  "details": {
    "browserPool": "2/3 available",
    "circuitBreaker": "CLOSED",
    "memory": "512MB / 2048MB",
    "queue": "5 pending / 500 max"
  }
}
```

**Unhealthy Response (503):**
```json
{
  "status": "unhealthy",
  "checks": {
    "browserPool": false,  // No browsers available
    "circuitBreaker": false,  // Circuit is OPEN
    "memory": false,  // Memory > 80%
    "queue": false  // Queue nearly full
  }
}
```

### Metrics Endpoint (New in v2.0.0)
```bash
GET /metrics
```

Public endpoint for comprehensive monitoring data.

**Response:**
```json
{
  "service": "pickmyclass-scraper",
  "version": "2.0.0",
  "timestamp": "2025-10-30T10:30:00.000Z",
  "uptime": 3600,
  "browserPool": {
    "total": 3,
    "available": 2,
    "busy": 1,
    "queued": 5
  },
  "circuitBreaker": {
    "state": "CLOSED",
    "failures": 0,
    "successes": 0,
    "lastFailureTime": null,
    "nextAttemptTime": null
  },
  "requestQueue": {
    "pending": 5,
    "active": 10,
    "completed": 1523,
    "failed": 42,
    "rejected": 0,
    "errorRate": "2.68%"
  },
  "memory": {
    "rss": "512MB",
    "heapUsed": "245MB",
    "heapTotal": "312MB",
    "external": "23MB"
  },
  "health": {
    "isHealthy": true,
    "memoryUsagePercent": "25.0%"
  }
}
```

### Browser Pool Status
```bash
GET /status
```

Public endpoint for browser pool metrics (legacy endpoint, use `/metrics` for comprehensive data).

**Response:**
```json
{
  "status": "ok",
  "service": "pickmyclass-scraper",
  "timestamp": "2025-10-30T10:30:00.000Z",
  "uptime": 3600,
  "browserPool": {
    "total": 3,
    "available": 2,
    "busy": 1,
    "queued": 5
  },
  "health": {
    "overloaded": false,
    "ready": true
  }
}
```

### Scrape Class Section
```bash
POST /scrape
Authorization: Bearer YOUR_SECRET_TOKEN
Content-Type: application/json

{
  "sectionNumber": "12431",
  "term": "2261"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "subject": "CSE",
    "catalog_nbr": "240",
    "title": "Introduction to Computer Science",
    "instructor": "Jane Smith",
    "seats_available": 5,
    "seats_capacity": 150,
    "location": "BYENG M1-17",
    "meeting_times": "MW 10:30AM-11:45AM"
  }
}
```

**Error Response (400/401/500):**
```json
{
  "success": false,
  "error": "Section 99999 not found for term 2261"
}
```

## Validation Rules

- **sectionNumber**: Must be 5 digits (e.g., "12431")
- **term**: Must be 4 digits (e.g., "2261")
- **Authorization**: Must include valid Bearer token

## Rate Limiting

- **Limit**: 1000 requests per minute per IP (16.6 req/sec)
- **Purpose**: Prevents accidental DDoS, not meant to throttle legitimate Workers traffic
- **Headers**: Rate limit info included in response headers

## Troubleshooting

### Server Crashes / OOM Kills

**Symptoms:**
- Docker container restarts unexpectedly
- `dmesg` shows "Out of memory: Killed process"
- Tailscale network drops
- Other services become unresponsive

**Diagnosis:**
```bash
# Check memory usage during operation
docker stats pickmyclass-scraper --no-stream

# Check for OOM kills
sudo dmesg -T | grep -i "out of memory\|oom\|killed process"

# Monitor health during cron job
watch -n 2 'curl -s http://localhost:3000/metrics | jq ".memory, .browserPool"'
```

**Solutions:**
1. **Increase Docker memory limit** (see docker-compose.yml)
2. **Reduce concurrent browsers** (set `MAX_CONCURRENT_BROWSERS=2`)
3. **Reduce concurrent requests** (set `MAX_CONCURRENT_REQUESTS=5`)
4. **Check circuit breaker state** (GET /metrics → circuitBreaker.state)

### Circuit Breaker Stuck OPEN

**Symptoms:**
- All scrapes failing with "Circuit breaker is OPEN"
- `/metrics` shows `circuitBreaker.state: "OPEN"`
- ASU site is actually working fine

**Diagnosis:**
```bash
# Check circuit breaker state
curl http://localhost:3000/metrics | jq ".circuitBreaker"

# Check next attempt time
curl http://localhost:3000/metrics | jq ".circuitBreaker.nextAttemptTime"
```

**Solutions:**
1. Wait for timeout to elapse (default: 2 minutes)
2. Restart service to reset circuit breaker
3. Increase `CIRCUIT_BREAKER_THRESHOLD` if too sensitive
4. Check ASU site availability manually

### Memory Leak Detection

**Symptoms:**
- Memory usage climbing over hours
- Health monitor logs: "Memory leak detected: growing at X MB/min"

**Diagnosis:**
```bash
# Monitor memory growth
watch -n 10 'curl -s http://localhost:3000/metrics | jq ".memory"'

# Check browser pool for stuck browsers
curl http://localhost:3000/metrics | jq ".browserPool"
```

**Solutions:**
1. Health monitor automatically detects leaks (threshold: 10 MB/min)
2. Restart service if leak confirmed
3. Check logs for unclosed pages (should not happen in v2.0.0)
4. Report issue with logs if leak persists

### Queue Full Errors

**Symptoms:**
- Scrapes failing with "Queue is full (500 requests pending)"
- `/metrics` shows `requestQueue.pending: 500`

**Diagnosis:**
```bash
# Check queue status
curl http://localhost:3000/metrics | jq ".requestQueue"

# Check if browsers are stuck
curl http://localhost:3000/metrics | jq ".browserPool"
```

**Solutions:**
1. Wait for queue to drain
2. Increase `MAX_CONCURRENT_REQUESTS` (default: 10)
3. Increase browser pool size (default: 3)
4. Check for circuit breaker OPEN state blocking all requests

### High Error Rate

**Symptoms:**
- `/metrics` shows `requestQueue.errorRate > 10%`
- Many scrapes failing

**Diagnosis:**
```bash
# Check error rate and circuit breaker
curl http://localhost:3000/metrics | jq "{errorRate: .requestQueue.errorRate, circuitState: .circuitBreaker.state}"

# Check recent failures
curl http://localhost:3000/metrics | jq ".circuitBreaker.failures"
```

**Solutions:**
1. Check if ASU site is down or slow
2. Check circuit breaker state (may be opening due to failures)
3. Review Docker logs for error patterns
4. Test ASU site manually: https://catalog.apps.asu.edu/catalog/classes/classlist

## Security Features

- Bearer token authentication on `/scrape` endpoint
- Helmet.js security headers
- CORS enabled (configure origins in production)
- Request validation and sanitization
- Rate limiting to prevent abuse

## Development

### Type Checking
```bash
bun run typecheck
```

### Build
```bash
bun run build
```

### Production
```bash
bun run start
```

## Implementation Status

**v2.0.0 COMPLETE - Production-grade rebuild:**

**Core Features (v1.0.0):**
- ✅ Express server with TypeScript
- ✅ Authentication middleware
- ✅ Rate limiting (1000 req/min)
- ✅ Full Puppeteer scraping logic
- ✅ Browser pool (3 browsers)
- ✅ React SPA handling (networkidle2 + delays)
- ✅ Seat parsing ("X of Y" format)
- ✅ Instructor extraction (handles "Staff" and names)
- ✅ Input validation
- ✅ Resource blocking (images, fonts, media)
- ✅ Graceful shutdown handlers

**Production Features (v2.0.0):**
- ✅ Circuit breaker pattern (fail fast on ASU downtime)
- ✅ Request queue with concurrency control (max 10 concurrent)
- ✅ Health monitoring with auto-recovery
- ✅ Memory leak detection (10 MB/min threshold)
- ✅ Comprehensive /metrics endpoint
- ✅ Enhanced /health endpoint (200/503 status codes)
- ✅ Guaranteed resource cleanup (page.close in try-catch)
- ✅ Timeout protection on page.evaluate() calls
- ✅ Server timeout configuration (60s)
- ✅ Docker memory limit increased (2GB)

**Future Enhancements:**
- Response caching (5-10 minute TTL)
- Screenshot capture on failures
- Grafana/Prometheus integration
- Auto-scaling browser pool based on load

## Scraping Strategy

### Performance Optimizations
1. **Browser Reuse**: Browser instance stays alive between requests
2. **Resource Blocking**: Blocks images (saves ~500KB per request)
3. **Request Interception**: Aborts unnecessary resource loads
4. **45s Timeout**: Generous timeout for slow ASU servers

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Section not found | Returns error with clear message |
| Timeout (>45s) | Returns timeout error |
| Parse failure | Returns parse error with context |
| Invalid table structure | Tries multiple tables before failing |
| Network error | Returns connection error |

### Logging
All operations log with prefixes:
- `[BrowserPool]` - Browser lifecycle
- `[Scraper]` - Scraping operations
- `[Parser]` - Data parsing warnings
- `[API]` - Express API events
- `[Auth]` - Authentication events

## Deployment Options

### Option 1: Oracle Cloud + Coolify (Recommended)
Deploy to your existing Oracle free tier server using Coolify.

**Pros:**
- Free forever (Oracle's permanent free tier)
- 4 CPUs, 24GB RAM (way more than needed)
- Easy deployment via Coolify
- Cloudflare Tunnel for secure public access

**Setup:**
1. Push code to Git repo
2. Create new service in Coolify
3. Point to repo
4. Set `SECRET_TOKEN` environment variable
5. Deploy
6. Configure Cloudflare Tunnel route: `pickmyclass-scraper.divkix.me`

**Docker Configuration** (see `docker-compose.yml`):
```yaml
services:
  asu-scraper:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - SECRET_TOKEN=${SECRET_TOKEN}
    restart: unless-stopped
```

### Option 2: Fly.io/Railway
Alternative if you don't want to use Oracle server.

**Pros:**
- Free tier available
- Auto-scaling and restarts
- Simple deployment

**Cons:**
- Less powerful (256MB RAM on free tier)
- May have usage limits

## Testing

### Manual Testing

```bash
# Health check
curl http://localhost:3000/health

# Scrape (requires token)
curl -X POST http://localhost:3000/scrape \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{
    "sectionNumber": "12431",
    "term": "2261"
  }'
```

### Automated Testing

```bash
# Run test script
node test-scraper.js

# Debug page structure
node debug-page.js
# Outputs: debug-screenshot.png, debug-page.html
```

## Integration with Cloudflare Workers

In your Cloudflare Workers cron job (`app/api/cron/route.ts`):

```typescript
const response = await fetch('http://pickmyclass-scraper.divkix.me/scrape', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${env.SCRAPER_SECRET_TOKEN}`,
  },
  body: JSON.stringify({
    sectionNumber: '12431',
    term: '2261'
  }),
})

const result = await response.json()
if (result.success) {
  // Update class_states table
  // Check for changes
  // Send notifications if needed
  console.log('Class details:', result.data)
}
```

**Add to `wrangler.jsonc`:**
```jsonc
{
  "vars": {
    "SCRAPER_URL": "http://pickmyclass-scraper.divkix.me"
  },
  "secrets": [
    "SCRAPER_SECRET_TOKEN"
  ]
}
```

## Performance Metrics (v2.0.0)

- **Cold Start**: ~3-5 seconds (3 browsers launch in batches)
- **Warm Request**: ~5-10 seconds (scrape with browser reuse)
- **Memory Usage**: ~450-600MB (3 browsers + Node.js + monitoring)
- **CPU Usage**: <10% idle, 50-80% during scrape
- **Max Throughput**: ~10-15 concurrent scrapes (with queue)
- **Circuit Breaker Overhead**: <1ms per request
- **Health Monitoring**: Check every 60 seconds

## File Structure (v2.0.0)

```
scraper/
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── .env.example          # Environment variable template
├── .gitignore            # Git ignore rules
├── README.md             # This file (v2.0.0 documentation)
├── Dockerfile            # Docker container definition
├── docker-compose.yml    # Docker Compose for Coolify (2GB memory)
├── test-scraper.js       # Test script for validation
├── debug-page.js         # Debug script for page inspection
└── src/
    ├── index.ts          # Express server and routes (v2.0.0 with circuit breaker, queue, health)
    ├── scraper.ts        # Puppeteer scraping logic (v2.0.0 with memory leak fixes)
    ├── circuit-breaker.ts # Circuit breaker pattern (NEW in v2.0.0)
    ├── queue.ts          # Request queue with concurrency control (NEW in v2.0.0)
    ├── health-monitor.ts # Health monitoring and auto-recovery (NEW in v2.0.0)
    └── types.ts          # TypeScript type definitions
```

## Known Issues

### ASU Table Structure Changes
ASU may change their HTML structure without notice.

**Mitigation**: Scraper uses heuristics (5-digit section number) to find correct table and columns, making it resilient to minor structural changes.

### Rate Limiting from ASU
ASU may rate limit or block repeated requests.

**Mitigation**:
- Space out cron checks by 15 minutes
- Use Cloudflare Workers IP rotation
- Implement exponential backoff on failures

### Invalid Terms
ASU terms are 4-digit codes (e.g., 2261 = Spring 2026).

**Solution**: Validate terms before deployment. Common format:
- 2xxx = Year (e.g., 2261 = 2026)
- x1 = Spring, x4 = Summer, x7 = Fall

## Future Optimizations

### Response Caching
```typescript
// Cache class states for 5-10 minutes
const cachedResult = await cache.get(`class:${sectionNumber}:${term}`)
if (cachedResult && Date.now() - cachedResult.timestamp < 300000) {
  return cachedResult.data
}
```

### Retry Logic
```typescript
// Retry up to 3 times with exponential backoff
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    return await scrapeClassSection(sectionNumber, term)
  } catch (error) {
    if (attempt === 3) throw error
    await new Promise(resolve => setTimeout(resolve, 2 ** attempt * 1000))
  }
}
```

### Metrics
- Track scrape duration (histogram)
- Track success/failure rates (counter)
- Alert on high failure rates (>10%)
- Grafana/Prometheus integration

## Notes

- Uses ES modules (`"type": "module"`)
- All imports must end with `.js` extension
- Strict TypeScript configuration enabled
- Rate limiting prevents abuse
- Bearer token authentication protects scrape endpoint
- Chromium runs with `--no-sandbox` for Docker compatibility
