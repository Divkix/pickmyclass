/**
 * Production-Ready Rate Limiting using Cloudflare KV
 *
 * This implements distributed rate limiting that works across Cloudflare's
 * global edge network. Unlike in-memory rate limiting, this maintains state
 * in KV storage which is accessible from all worker instances.
 *
 * Algorithm: Sliding Window with KV Storage
 * - Stores timestamps of requests in KV as JSON array
 * - Automatically cleans up old timestamps
 * - Uses KV TTL for automatic expiration
 *
 * Limitations:
 * - KV is eventually consistent (1-60 seconds propagation)
 * - Under high concurrency, may allow slightly more requests than limit
 * - For stronger consistency, use Durable Objects (but costs money)
 */

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  windowMs: number // Time window in milliseconds
  maxRequests: number // Maximum requests allowed in window
}

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  allowed: boolean // Whether request should be allowed
  remaining: number // Requests remaining in window
  resetAt: number // Unix timestamp (ms) when limit resets
  limit: number // Maximum requests in window
}

/**
 * Check if request should be rate limited using Cloudflare KV
 *
 * @param kv - Cloudflare KV namespace binding
 * @param identifier - Unique identifier (usually IP address)
 * @param config - Rate limit configuration
 * @returns Rate limit result
 */
export async function checkRateLimitKV(
  kv: KVNamespace,
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const now = Date.now()
  const key = `ratelimit:${identifier}`
  const windowStart = now - config.windowMs

  try {
    // Get current request timestamps from KV
    const data = await kv.get(key, 'json')
    const timestamps = (data as number[]) || []

    // Remove timestamps outside the current window (sliding window)
    const validTimestamps = timestamps.filter((timestamp) => timestamp > windowStart)

    // Check if limit exceeded
    const requestCount = validTimestamps.length
    const allowed = requestCount < config.maxRequests

    if (allowed) {
      // Add current request timestamp
      validTimestamps.push(now)

      // Store updated timestamps with TTL equal to window duration
      // KV will automatically delete the key after TTL expires
      await kv.put(key, JSON.stringify(validTimestamps), {
        expirationTtl: Math.ceil(config.windowMs / 1000),
      })
    }

    // Calculate remaining requests and reset time
    const remaining = Math.max(0, config.maxRequests - validTimestamps.length)
    const oldestTimestamp = validTimestamps[0] || now
    const resetAt = oldestTimestamp + config.windowMs

    return {
      allowed,
      remaining,
      resetAt,
      limit: config.maxRequests,
    }
  } catch (error) {
    // If KV fails, fail open (allow request) to prevent blocking legitimate users
    console.error('[RateLimit] KV error, failing open:', error)
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: now + config.windowMs,
      limit: config.maxRequests,
    }
  }
}

/**
 * Get client IP address from request
 * Works with Cloudflare's CF-Connecting-IP header
 *
 * @param request - Incoming request
 * @returns Client IP address
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
 *
 * @param result - Rate limit result
 * @returns HTTP 429 Response with rate limit headers
 */
export function createRateLimitResponse(result: RateLimitResult): Response {
  const resetSeconds = Math.ceil((result.resetAt - Date.now()) / 1000)

  return new Response(
    JSON.stringify({
      error: 'Too many requests. Please try again later.',
      retryAfter: resetSeconds,
      limit: result.limit,
      remaining: 0,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': result.limit.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': Math.floor(result.resetAt / 1000).toString(),
        'Retry-After': resetSeconds.toString(),
      },
    }
  )
}

/**
 * Add rate limit headers to an existing response
 *
 * @param response - Original response
 * @param result - Rate limit result
 * @returns Response with rate limit headers added
 */
export function addRateLimitHeaders(
  response: Response,
  result: RateLimitResult
): Response {
  const headers = new Headers(response.headers)
  headers.set('X-RateLimit-Limit', result.limit.toString())
  headers.set('X-RateLimit-Remaining', result.remaining.toString())
  headers.set('X-RateLimit-Reset', Math.floor(result.resetAt / 1000).toString())

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Predefined rate limit configurations
 *
 * Usage:
 * - STRICT: Auth endpoints (prevent brute force)
 * - MODERATE: Write endpoints (normal usage with headroom)
 * - GENEROUS: Read endpoints (dashboard refreshes)
 */
export const RATE_LIMITS = {
  // Auth endpoints: 5 requests per hour (strict)
  AUTH: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 5,
  },
  // Login endpoint: 10 requests per hour (moderate)
  LOGIN: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10,
  },
  // Write operations: 10 requests per minute (moderate)
  WRITE: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10,
  },
  // Read operations: 60 requests per minute (generous)
  READ: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60,
  },
} as const
