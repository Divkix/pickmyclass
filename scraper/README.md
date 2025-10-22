# PickMyClass Scraper Service

Puppeteer-based scraper service for extracting ASU class details from section numbers.

## Architecture

This service runs as a standalone Express server that:
- Accepts authenticated POST requests with section numbers and terms
- Uses Puppeteer to scrape ASU's class search website
- Returns parsed class details (seats, instructor, location, etc.)
- Protects against abuse with rate limiting and bearer token auth

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
    "instructor": "Staff",
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
  "error": "Error message here"
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

## Current Status: Phase 1

**Implemented:**
- Express server with TypeScript
- Authentication middleware
- Rate limiting
- Health check endpoint
- Scrape endpoint (stub implementation)
- Input validation
- Error handling

**TODO (Phase 2):**
- Implement actual Puppeteer scraping logic
- Navigate to ASU class search URL
- Parse HTML table data
- Extract seats, instructor, location, times
- Handle edge cases (section not found, timeouts)
- Add retry logic
- Add request caching

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
6. Configure Cloudflare Tunnel route

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

## Integration with Cloudflare Workers

In your Cloudflare Workers cron job:

```typescript
const response = await fetch('https://scraper.yourdomain.com/scrape', {
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
  console.log('Class details:', result.data)
}
```

## File Structure

```
scraper/
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── .env.example          # Environment variable template
├── .gitignore            # Git ignore rules
├── README.md             # This file
└── src/
    ├── index.ts          # Express server and routes
    ├── scraper.ts        # Puppeteer scraping logic (stub)
    └── types.ts          # TypeScript type definitions
```

## Notes

- Uses ES modules (`"type": "module"`)
- All imports must end with `.js` extension
- Strict TypeScript configuration enabled
- Rate limiting prevents abuse
- Bearer token authentication protects scrape endpoint
