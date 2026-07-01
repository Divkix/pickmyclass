import { type NextRequest } from 'next/server';
import { loginSchema } from '@/lib/api/schemas';
import { log } from '@/lib/log';
import { mapValidationIssues } from '@/lib/api/validation';
import { fail, ok } from '@/lib/api/response';
import {
  checkLockoutStatus,
  clearFailedAttempts,
  getRemainingLockoutTime,
  incrementFailedAttempts,
  MAX_FAILED_ATTEMPTS,
} from '@/lib/auth/lockout';
import { readAuthorizationState } from '@/lib/auth/authorization-state';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = loginSchema.safeParse(body);

    if (!validation.success) {
      return fail('Invalid input', 400, mapValidationIssues(validation.error));
    }

    const email = validation.data.email.toLowerCase();
    const password = validation.data.password;

    const lockoutStatus = await checkLockoutStatus(email);

    if (lockoutStatus.isLocked) {
      return fail(
        'Account locked due to too many failed login attempts. Please try again later.',
        423,
        {
          isLocked: true,
          remainingMinutes: getRemainingLockoutTime(lockoutStatus.lockedUntil),
        }
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // Check if user account is disabled before proceeding. FRESH read (never
    // cached) so a just-disabled account cannot log back in.
    if (data?.user) {
      const authState = await readAuthorizationState(supabase, data.user.id, { cache: false });

      if (authState?.is_disabled) {
        await supabase.auth.signOut();
        return fail('Account has been disabled', 403);
      }
    }

    if (error || !data?.user) {
      await incrementFailedAttempts(email);
      const updatedStatus = await checkLockoutStatus(email);
      const attempts = updatedStatus.attempts ?? 0;
      const remainingAttempts = Math.max(0, MAX_FAILED_ATTEMPTS - attempts);

      return fail(
        updatedStatus.isLocked
          ? 'Too many failed login attempts. Your account has been locked for 15 minutes.'
          : error?.message || 'Invalid email or password',
        updatedStatus.isLocked ? 423 : 401,
        {
          isLocked: updatedStatus.isLocked,
          remainingAttempts,
          remainingMinutes: updatedStatus.isLocked
            ? getRemainingLockoutTime(updatedStatus.lockedUntil)
            : undefined,
        }
      );
    }

    await clearFailedAttempts(email);

    return ok(null);
  } catch (err) {
    log('Auth').error('Unexpected error:', err);
    return fail('Failed to sign in', 500);
  }
}
