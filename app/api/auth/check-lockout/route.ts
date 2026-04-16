import { type NextRequest, NextResponse } from 'next/server';
import { checkLockoutSchema } from '@/lib/api/schemas';
import { mapValidationIssues } from '@/lib/api/validation';
import { checkLockoutStatus, getRemainingLockoutTime } from '@/lib/auth/lockout';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = checkLockoutSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: mapValidationIssues(validation.error),
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
