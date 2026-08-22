import { NextResponse } from 'next/server';
import { callFunction, queryOne } from '@/lib/db/client';
import { safeInternalPath } from '@/lib/auth/safe-redirect';
import { invalidateAuthorizationState } from '@/lib/auth/authorization-state';
import { getClerkClient, getSessionIdentity } from '@/lib/auth/clerk-session';
import { ensureUserMirror } from '@/lib/db/users';
import { log } from '@/lib/log';

// Redirects always resolve against the request origin. `x-forwarded-host` is
// client-controllable (host-header injection / open redirect), so it must never
// influence where OAuth callbacks send the user.
function consentRedirect(base: string, next: string, saveFailed = false): NextResponse {
  const url = new URL('/consent', base);
  if (saveFailed) url.searchParams.set('error', 'save_failed');
  url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

/**
 * Post-OAuth landing route (Clerk edition of the old /auth/callback).
 *
 * clerk-js completes the OAuth handshake on the /auth/callback page and then
 * navigates here with a live session. This route performs the server-side
 * bookkeeping the old code-exchange callback did:
 *   1. Repair the webhook race (mirror + profile row) for first-time OAuth users.
 *   2. If the register page marked the flow `consent=confirmed` (checkboxes were
 *      ticked before redirect), record consent timestamps now.
 *   3. Otherwise read the profile and route to /consent when timestamps are missing.
 *   4. Redirect to `next` (open-redirect-guarded).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const consentConfirmed = searchParams.get('consent') === 'confirmed';
  // Default to home - middleware will route to /admin or /dashboard based on is_admin flag
  const next = safeInternalPath(searchParams.get('next'), '/');

  const identity = await getSessionIdentity(request);
  if (!identity) {
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }

  const base = origin;
  const userId = identity.userId;

  try {
    // Ensure the mirror + profile rows exist before consent bookkeeping.
    const existing = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM user_profiles WHERE user_id = $1',
      [userId]
    );
    if (!existing) {
      const clerkUser = await getClerkClient().users.getUser(identity.clerkUserId);
      const email = clerkUser.emailAddresses
        .find((e) => e.id === clerkUser.primaryEmailAddressId)
        ?.emailAddress.toLowerCase();
      if (!email) {
        log('Auth').error(`No primary email on Clerk user ${identity.clerkUserId}`);
        return consentRedirect(base, next, true);
      }
      await ensureUserMirror(userId, identity.clerkUserId, email);
    }

    if (consentConfirmed) {
      try {
        await callFunction('accept_terms_and_verify_age', [userId]);
        invalidateAuthorizationState(userId);
      } catch {
        return consentRedirect(base, next, true);
      }
    } else {
      const profile = await queryOne<{
        age_verified_at: string | null;
        agreed_to_terms_at: string | null;
      }>('SELECT age_verified_at, agreed_to_terms_at FROM user_profiles WHERE user_id = $1', [
        userId,
      ]);

      if (!profile?.age_verified_at || !profile.agreed_to_terms_at) {
        return consentRedirect(base, next);
      }
    }

    return NextResponse.redirect(`${base}${next}`);
  } catch (error) {
    log('Auth').error('post-oauth handling failed:', error);
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }
}
