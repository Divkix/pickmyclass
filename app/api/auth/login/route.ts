import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  checkLockoutStatus,
  clearFailedAttempts,
  getRemainingLockoutTime,
  incrementFailedAttempts,
  MAX_FAILED_ATTEMPTS,
} from '@/lib/auth/lockout';
import { createClient } from '@/lib/supabase/server';

const loginSchema = z.object({
  email: z.string().email('Invalid email address').min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = loginSchema.safeParse(body);

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

    const email = validation.data.email.toLowerCase();
    const password = validation.data.password;

    const lockoutStatus = await checkLockoutStatus(email);

    if (lockoutStatus.isLocked) {
      return NextResponse.json(
        {
          error: 'Account locked due to too many failed login attempts. Please try again later.',
          isLocked: true,
          remainingMinutes: getRemainingLockoutTime(lockoutStatus.lockedUntil),
        },
        { status: 423 }
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data?.user) {
      await incrementFailedAttempts(email);
      const updatedStatus = await checkLockoutStatus(email);
      const attempts = updatedStatus.attempts ?? 0;
      const remainingAttempts = Math.max(0, MAX_FAILED_ATTEMPTS - attempts);

      return NextResponse.json(
        {
          error: updatedStatus.isLocked
            ? 'Too many failed login attempts. Your account has been locked for 15 minutes.'
            : error?.message || 'Invalid email or password',
          isLocked: updatedStatus.isLocked,
          remainingAttempts,
          remainingMinutes: updatedStatus.isLocked
            ? getRemainingLockoutTime(updatedStatus.lockedUntil)
            : undefined,
        },
        { status: updatedStatus.isLocked ? 423 : 401 }
      );
    }

    await clearFailedAttempts(email);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Auth Login] Unexpected error:', err);
    return NextResponse.json({ error: 'Failed to sign in' }, { status: 500 });
  }
}
