import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import { scrapeClassSection, isValidSectionNumber, isValidTerm } from './scraper.js'
import type { ScrapeRequest, ScrapeResponse } from './types.js'

// Load environment variables
dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000
const SECRET_TOKEN = process.env.SECRET_TOKEN

if (!SECRET_TOKEN) {
  console.warn('[Warning] SECRET_TOKEN not set in environment - authentication will fail')
}

// Middleware
app.use(helmet())
app.use(cors())
app.use(express.json())

// Rate limiting: 100 requests per 15 minutes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
})

app.use(limiter)

/**
 * Authentication middleware
 * Checks for Bearer token in Authorization header
 */
const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization

  if (!authHeader) {
    res.status(401).json({ error: 'Missing Authorization header' })
    return
  }

  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Invalid Authorization format. Use: Bearer <token>' })
    return
  }

  const token = authHeader.substring(7) // Remove 'Bearer ' prefix

  if (token !== SECRET_TOKEN) {
    console.warn('[Auth] Unauthorized access attempt with invalid token')
    res.status(401).json({ error: 'Invalid token' })
    return
  }

  console.log('[Auth] Request authenticated successfully')
  next()
}

/**
 * Health check endpoint
 * Public - no authentication required
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'pickmyclass-scraper',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

/**
 * Scrape endpoint
 * Protected - requires Bearer token authentication
 *
 * Request body:
 * {
 *   "sectionNumber": "12431",
 *   "term": "2261"
 * }
 */
app.post('/scrape', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { sectionNumber, term } = req.body as ScrapeRequest

    // Validate required fields
    if (!sectionNumber || !term) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: sectionNumber and term'
      } as ScrapeResponse)
      return
    }

    // Validate formats
    if (!isValidSectionNumber(sectionNumber)) {
      res.status(400).json({
        success: false,
        error: 'Invalid sectionNumber format. Expected 5 digits (e.g., "12431")'
      } as ScrapeResponse)
      return
    }

    if (!isValidTerm(term)) {
      res.status(400).json({
        success: false,
        error: 'Invalid term format. Expected 4 digits (e.g., "2261")'
      } as ScrapeResponse)
      return
    }

    console.log(`[API] Received scrape request: section=${sectionNumber}, term=${term}`)

    // Perform scraping
    const classDetails = await scrapeClassSection(sectionNumber, term)

    res.json({
      success: true,
      data: classDetails
    } as ScrapeResponse)

  } catch (error) {
    console.error('[API] Scraping error:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

    res.status(500).json({
      success: false,
      error: errorMessage
    } as ScrapeResponse)
  }
})

/**
 * 404 handler for unknown routes
 */
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Route not found',
    availableEndpoints: {
      health: 'GET /health',
      scrape: 'POST /scrape (requires auth)'
    }
  })
})

/**
 * Global error handler
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error] Unhandled error:', err)
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  })
})

/**
 * Start server
 */
app.listen(PORT, () => {
  console.log('='.repeat(50))
  console.log(`[Server] PickMyClass Scraper Service`)
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`[Server] Listening on port ${PORT}`)
  console.log(`[Server] Health check: http://localhost:${PORT}/health`)
  console.log(`[Server] Auth enabled: ${!!SECRET_TOKEN}`)
  console.log('='.repeat(50))
})
