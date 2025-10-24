import { NextRequest, NextResponse } from 'next/server'
import { clearFailedAttempts } from '@/lib/auth/lockout'
import { z } from 'zod'

export const runtime = 'edge'

/**
 * Validation schema
 */
const clearFailedAttemptsSchema = z.object({
  email: z.string().email('Invalid email address').min(1, 'Email is required'),
})

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json()
    const validation = clearFailedAttemptsSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: validation.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        },
        { status: 400 }
      )
    }

    const { email } = validation.data

    await clearFailedAttempts(email)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error clearing failed attempts:', error)
    return NextResponse.json(
      { error: 'Failed to clear attempts' },
      { status: 500 }
    )
  }
}
