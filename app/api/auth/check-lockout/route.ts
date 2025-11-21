import { NextRequest, NextResponse } from 'next/server'
import { checkLockoutStatus, getRemainingLockoutTime } from '@/lib/auth/lockout'
import { z } from 'zod'

/**
 * Simple in-memory rate limiter for lockout check endpoint
 * Note: This is per-isolate in Cloudflare Workers, but provides basic protection
 * against rapid-fire requests from the same IP
 */
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT_WINDOW_MS = 60000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10 // 10 requests per minute per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const record = rateLimitMap.get(ip)

  // Clean up expired entries periodically
  if (rateLimitMap.size > 1000) {
    for (const [key, value] of rateLimitMap.entries()) {
      if (value.resetTime < now) {
        rateLimitMap.delete(key)
      }
    }
  }

  if (!record || record.resetTime < now) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS })
    return false
  }

  record.count++
  if (record.count > RATE_LIMIT_MAX_REQUESTS) {
    return true
  }

  return false
}

/**
 * Validation schema
 */
const checkLockoutSchema = z.object({
  email: z.string().email('Invalid email address').min(1, 'Email is required'),
})

export async function POST(request: NextRequest) {
  try {
    // Basic rate limiting based on IP
    const ip = request.headers.get('cf-connecting-ip') ||
               request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               request.headers.get('x-real-ip') ||
               'unknown'

    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': '60',
          },
        }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const validation = checkLockoutSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'production'
            ? [{ message: 'Invalid input format' }]
            : validation.error.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: issue.message,
              })),
        },
        { status: 400 }
      )
    }

    const { email } = validation.data

    const status = await checkLockoutStatus(email)

    return NextResponse.json({
      isLocked: status.isLocked,
      attempts: status.attempts,
      remainingMinutes: getRemainingLockoutTime(status.lockedUntil),
    })
  } catch (error) {
    console.error('Error checking lockout status:', error)
    return NextResponse.json(
      { error: 'Failed to check lockout status' },
      { status: 500 }
    )
  }
}
