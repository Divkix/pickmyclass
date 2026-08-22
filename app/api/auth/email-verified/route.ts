import { type NextRequest } from 'next/server';
import { fail, ok } from '@/lib/api/response';
import { getClerkClient } from '@/lib/auth/clerk-session';
import { requireUser, UnauthorizedError } from '@/lib/auth/require-user';
import { markEmailVerified } from '@/lib/db/users';
import { log } from '@/lib/log';

/**
 * Confirm email verification after the client-side clerk-react code flow.
 *
 * The browser's `emailAddress.attemptVerification()` marks the address
 * verified at Clerk, but the edge gate reads `users.email_confirmed_at` from
 * the webhook-synced mirror — and webhook latency (plus the 30s gate cache)
 * would bounce a just-verified user back to /verify-email. This route checks
 * the status with Clerk directly (source of truth) and writes the mirror
 * synchronously, so the next gate read passes.
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);

    const clerkUser = await getClerkClient().users.getUser(user.clerkUserId);
    const primary = clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId);
    if (primary?.verification?.status !== 'verified') {
      return fail('Email is not verified yet', 409);
    }

    await markEmailVerified(user.userId);
    return ok(null);
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail('Unauthorized', 401);
    log('Auth').error('email-verified confirmation failed:', error);
    return fail('Could not confirm verification', 500);
  }
}
