import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { log } from '@/lib/log';
import { safeInternalPath } from '@/lib/auth/safe-redirect';
import { invalidateAuthorizationState } from '@/lib/auth/authorization-state';
import { getSessionIdentity } from '@/lib/auth/clerk-session';
import { getDbFromEnv } from '@/lib/db';
import { repairUserMirror } from '@/lib/db/users';

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
 *   1. Repair the webhook race (mirror + profile row) for first-time OAuth
 *      users via `repairUserMirror`, which reports whether consent timestamps
 *      already exist.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const consentConfirmed = searchParams.get('consent') === 'confirmed';
  // Default to home - middleware will route to /admin or /dashboard based on is_admin flag
  const next = safeInternalPath(searchParams.get('next'), '/');

  const identity = await getSessionIdentity(request);
  if (!identity) {
    return NextResponse.redirect(`${origin}/sign-in?error=oauth_failed`);
  }

  const base = origin;
  const userId = identity.userId;

  try {
    // Repair the webhook race (mirror + profile row) before consent bookkeeping.
    // One request-scoped handle covers both this repair and the consent RPC.
    const db = getDbFromEnv();
    const repairResult = await repairUserMirror(db, userId, identity.clerkUserId);
    if (!repairResult) {
      log('Auth').error(`No primary email on Clerk user ${identity.clerkUserId}`);
      return consentRedirect(base, next, true);
    }

    if (consentConfirmed) {
      try {
        await db.execute(sql`SELECT public.accept_terms_and_verify_age(${userId}::text)`);
        invalidateAuthorizationState(userId);
      } catch {
        return consentRedirect(base, next, true);
      }
    } else if (!repairResult.hasConsent) {
      return consentRedirect(base, next);
    }

    return NextResponse.redirect(`${base}${next}`);
  } catch (error) {
    log('Auth').error('post-oauth handling failed:', error);
    return NextResponse.redirect(`${origin}/sign-in?error=oauth_failed`);
  }
}
