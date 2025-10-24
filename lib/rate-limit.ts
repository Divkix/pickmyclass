/**
 * Rate Limiting Utility for Cloudflare Workers
 *
 * ⚠️ WARNING: This in-memory rate limiter does NOT work in production!
 *
 * Cloudflare Workers run in distributed isolates across multiple edge locations.
 * In-memory state (Map) is NOT shared between worker instances, making rate
 * limiting ineffective. Users can bypass limits by hitting different edge locations.
 *
 * This file is kept for reference but SHOULD NOT be used in production.
 *
 * For production rate limiting:
 * - Use Cloudflare's built-in DDoS protection (recommended)
 * - Use Cloudflare KV with TTL for distributed state
 * - Use Cloudflare Durable Objects for stronger consistency
 * - Implement database-based rate limiting with Supabase
 *
 * In-memory rate limiter using Map with automatic cleanup.
 * Tracks requests by IP address with sliding window algorithm.
 */

interface RateLimitConfig {
  windowMs: number // Time window in milliseconds
  maxRequests: number // Maximum requests allowed in window
}

interface RequestLog {
  timestamps: number[] // Array of request timestamps
  lastCleanup: number // Last cleanup timestamp
}

// In-memory store for rate limit tracking
// Key: IP address
// Value: RequestLog with timestamps of recent requests
const rateLimitStore = new Map<string, RequestLog>()

// Cleanup interval (remove old entries every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000

/**
 * Check if request should be rate limited
 *
 * @param identifier - Unique identifier (usually IP address)
 * @param config - Rate limit configuration
 * @returns Object with allowed status and remaining requests
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  const windowStart = now - config.windowMs

  // Get or create request log for this identifier
  let requestLog = rateLimitStore.get(identifier)

  if (!requestLog) {
    requestLog = {
      timestamps: [],
      lastCleanup: now,
    }
    rateLimitStore.set(identifier, requestLog)
  }

  // Remove timestamps outside the current window (sliding window)
  requestLog.timestamps = requestLog.timestamps.filter((timestamp) => timestamp > windowStart)

  // Check if limit exceeded
  const requestCount = requestLog.timestamps.length
  const allowed = requestCount < config.maxRequests

  if (allowed) {
    // Add current request timestamp
    requestLog.timestamps.push(now)
  }

  // Calculate remaining requests and reset time
  const remaining = Math.max(0, config.maxRequests - requestLog.timestamps.length)
  const oldestTimestamp = requestLog.timestamps[0] || now
  const resetAt = oldestTimestamp + config.windowMs

  // Periodic cleanup of old entries
  if (now - requestLog.lastCleanup > CLEANUP_INTERVAL) {
    cleanupRateLimitStore(now - config.windowMs)
    requestLog.lastCleanup = now
  }

  return { allowed, remaining, resetAt }
}

/**
 * Cleanup old entries from the rate limit store
 * Removes identifiers with no recent requests
 */
function cleanupRateLimitStore(cutoffTime: number): void {
  for (const [identifier, log] of rateLimitStore.entries()) {
    // Remove entries with no timestamps in the current window
    if (log.timestamps.length === 0 || log.timestamps[log.timestamps.length - 1] < cutoffTime) {
      rateLimitStore.delete(identifier)
    }
  }
}

/**
 * Get client IP address from request
 * Works with Cloudflare's CF-Connecting-IP header
 */
export function getClientIP(request: Request): string {
  // Cloudflare provides the real client IP in CF-Connecting-IP header
  const cfConnectingIP = request.headers.get('CF-Connecting-IP')
  if (cfConnectingIP) {
    return cfConnectingIP
  }

  // Fallback to X-Forwarded-For
  const xForwardedFor = request.headers.get('X-Forwarded-For')
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim()
  }

  // Last resort: use a placeholder (shouldn't happen on Cloudflare)
  return 'unknown'
}

/**
 * Create rate limit response with appropriate headers
 */
export function createRateLimitResponse(
  remaining: number,
  resetAt: number,
  limit: number
): Response {
  const resetSeconds = Math.ceil((resetAt - Date.now()) / 1000)

  return new Response(
    JSON.stringify({
      error: 'Too many requests. Please try again later.',
      retryAfter: resetSeconds,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': Math.floor(resetAt / 1000).toString(),
        'Retry-After': resetSeconds.toString(),
      },
    }
  )
}

/**
 * Add rate limit headers to response
 */
export function addRateLimitHeaders(
  response: Response,
  remaining: number,
  resetAt: number,
  limit: number
): Response {
  const headers = new Headers(response.headers)
  headers.set('X-RateLimit-Limit', limit.toString())
  headers.set('X-RateLimit-Remaining', remaining.toString())
  headers.set('X-RateLimit-Reset', Math.floor(resetAt / 1000).toString())

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Predefined rate limit configurations
 */
export const RATE_LIMITS = {
  // Read operations: 60 requests per minute
  GET: {
    windowMs: 60 * 1000,
    maxRequests: 60,
  },
  // Write operations: 10 requests per minute (more strict)
  POST: {
    windowMs: 60 * 1000,
    maxRequests: 10,
  },
  DELETE: {
    windowMs: 60 * 1000,
    maxRequests: 10,
  },
} as const
