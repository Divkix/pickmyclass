import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { log } from '@/lib/log';
import { safeInternalPath } from '@/lib/auth/safe-redirect';
import { invalidateAuthorizationState } from '@/lib/auth/authorization-state';
import { getClerkClient, getSessionIdentity } from '@/lib/auth/clerk-session';
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

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const consentConfirmed = searchParams.get('consent') === 'confirmed';
  const next = safeInternalPath(searchParams.get('next'), '/');

  const identity = await getSessionIdentity(request);
  if (!identity) {
    return NextResponse.redirect(`${origin}/sign-in?error=oauth_failed`);
  }

  const base = origin;
  const userId = identity.userId;

  try {
    const db = getDbFromEnv();
    const clerkUser = await getClerkClient().users.getUser(identity.clerkUserId);
    const repairResult = await repairUserMirror(db, userId, clerkUser);
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
