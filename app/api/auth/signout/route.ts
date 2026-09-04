import { type NextRequest } from 'next/server';
import { ok } from '@/lib/api/response';
import { CLERK_COOKIES_TO_CLEAR } from '@/lib/auth/clerk-cookies';
import { getSessionIdentity, revokeSession } from '@/lib/auth/clerk-session';
import { log } from '@/lib/log';

export async function POST(request: NextRequest) {
  try {
    const identity = await getSessionIdentity(request);
    if (identity?.sessionId) {
      try {
        await revokeSession(identity.sessionId);
      } catch (error) {
        log('Auth').warn('Failed to revoke Clerk session:', error);
      }
    }
  } catch (error) {
    log('Auth').warn('Sign-out session lookup failed:', error);
  }

  const response = ok(null);
  for (const name of CLERK_COOKIES_TO_CLEAR) {
    response.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
  return response;
}
