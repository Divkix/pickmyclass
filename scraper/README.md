# PickMyClass Scraper Service

Puppeteer-based scraper service for extracting ASU class details from section numbers.

## Architecture

This service runs as a standalone Express server that:
- Accepts authenticated POST requests with section numbers and terms
- Uses Puppeteer to scrape ASU's class search website (React SPA)
- Returns parsed class details (seats, instructor, location, etc.)
- Protects against abuse with rate limiting and bearer token auth
- Maintains a browser pool for performance (~5-10s vs ~15-20s per request)

### Browser Pool Implementation
- **Singleton Pattern**: Maintains a single headless Chromium instance across requests
- **Connection Reuse**: Reuses browser to avoid ~3-5 second launch overhead
- **Graceful Shutdown**: Handles SIGINT/SIGTERM to properly close browser
- **Race Condition Handling**: Prevents multiple simultaneous browser launches

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
- `SECRET_TOKEN`: Generate with `openssl rand -hex 32`
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Set to `production` when deploying

### 3. Run Development Server

```bash
bun run dev
```

Server starts at `http://localhost:3000`

## API Endpoints

### Health Check
```bash
GET /health
```

Public endpoint for monitoring service health.

**Response:**
```json
{
  "status": "ok",
  "service": "pickmyclass-scraper",
  "version": "1.0.0",
  "timestamp": "2025-10-22T10:30:00.000Z",
  "uptime": 3600
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

- **Limit**: 100 requests per 15 minutes per IP
- **Headers**: Rate limit info included in response headers

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

**Phase 2 COMPLETE - Puppeteer scraping implemented:**

**Implemented:**
- ✅ Express server with TypeScript
- ✅ Authentication middleware
- ✅ Rate limiting
- ✅ Health check endpoint
- ✅ Full Puppeteer scraping logic
- ✅ Browser pool for performance
- ✅ React SPA handling (networkidle2 + delays)
- ✅ Table structure detection with heuristics
- ✅ Seat parsing ("X of Y" format)
- ✅ Instructor extraction (handles "Staff" and names)
- ✅ Input validation
- ✅ Comprehensive error handling
- ✅ Resource blocking (images, fonts, media)
- ✅ Graceful shutdown handlers

**TODO (Phase 3 - Optimizations):**
- Response caching (5-10 minute TTL)
- Retry logic with exponential backoff
- Screenshot capture on failures
- Metrics/monitoring integration
- Connection pooling for multiple browsers

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

## Performance Metrics

- **Cold Start**: ~3-5 seconds (browser launch)
- **Warm Request**: ~5-10 seconds (scrape with browser reuse)
- **Memory Usage**: ~150-200MB (browser + Node.js)
- **CPU Usage**: <10% idle, 50-80% during scrape

## File Structure

```
scraper/
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── .env.example          # Environment variable template
├── .gitignore            # Git ignore rules
├── README.md             # This file
├── Dockerfile            # Docker container definition
├── docker-compose.yml    # Docker Compose for Coolify
├── test-scraper.js       # Test script for validation
├── debug-page.js         # Debug script for page inspection
└── src/
    ├── index.ts          # Express server and routes
    ├── scraper.ts        # Puppeteer scraping logic (COMPLETE)
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
