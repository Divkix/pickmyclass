import { NextRequest, NextResponse } from 'next/server'
import { incrementFailedAttempts } from '@/lib/auth/lockout'
import { z } from 'zod'

/**
 * Validation schema
 */
const incrementAttemptsSchema = z.object({
  email: z.string().email('Invalid email address').min(1, 'Email is required'),
})

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json()
    const validation = incrementAttemptsSchema.safeParse(body)

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

    await incrementFailedAttempts(email)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error incrementing failed attempts:', error)
    return NextResponse.json(
      { error: 'Failed to increment attempts' },
      { status: 500 }
    )
  }
}
