import { type NextRequest, NextResponse } from 'next/server';
import { loginSchema } from '@/lib/api/schemas';
import { mapValidationIssues } from '@/lib/api/validation';
import {
  checkLockoutStatus,
  clearFailedAttempts,
  getRemainingLockoutTime,
  incrementFailedAttempts,
  MAX_FAILED_ATTEMPTS,
} from '@/lib/auth/lockout';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = loginSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: mapValidationIssues(validation.error),
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

    // Check if user account is disabled before proceeding
    if (data?.user) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('is_disabled')
        .eq('user_id', data.user.id)
        .single();

      if (profile?.is_disabled) {
        await supabase.auth.signOut();
        return NextResponse.json({ error: 'Account has been disabled' }, { status: 403 });
      }
    }

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
