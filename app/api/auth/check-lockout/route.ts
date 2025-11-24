import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkLockoutStatus, getRemainingLockoutTime } from '@/lib/auth/lockout';

/**
 * Validation schema
 */
const checkLockoutSchema = z.object({
  email: z.string().email('Invalid email address').min(1, 'Email is required'),
});

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();
    const validation = checkLockoutSchema.safeParse(body);

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
      );
    }

    const { email } = validation.data;

    const status = await checkLockoutStatus(email);

    return NextResponse.json({
      isLocked: status.isLocked,
      attempts: status.attempts,
      remainingMinutes: getRemainingLockoutTime(status.lockedUntil),
    });
  } catch (error) {
    console.error('Error checking lockout status:', error);
    return NextResponse.json({ error: 'Failed to check lockout status' }, { status: 500 });
  }
}
