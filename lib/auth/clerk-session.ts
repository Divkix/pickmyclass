/**
 * Clerk session seam — the only module that talks to Clerk for identity.
 *
 * Server-only: imported by proxy.ts, API routes, and RSC admin gates. Never
 * import this from a client bundle (it reads the secret key).
 *
 * Identity model (issue #351):
 * - The session token carries the custom claim template
 *   `{"ext_id": "{{user.external_id || user.id}}"}`.
 * - `ext_id` is the stable app user id: the OLD Supabase UUID for migrated
 *   users (Clerk externalId), the Clerk user id for users created after
 *   cutover. It is the PK of the local `users` mirror and the FK target of
 *   `user_profiles.user_id` / `class_watches.user_id`.
 * - Volatile authorization state (is_admin / is_disabled / consent) stays in
 *   `user_profiles`, read via lib/auth/authorization-state.ts — NOT in JWT
 *   claims (1.2 KB budget, up to 60 s refresh lag).
 *
 * Verification is networkless: the PEM `jwtKey` verifies RS256 in-isolate
 * (proven under workerd in the §0 spike), so the edge gate adds zero network
 * round-trips versus the old Supabase getUser() call per request.
 */

import { type ClerkClient, createClerkClient } from '@clerk/backend';
import { env } from 'cloudflare:workers';
import { CLERK_PUBLISHABLE_KEY } from '@/lib/clerk/config';
import { log } from '@/lib/log';

export interface SessionIdentity {
  userId: string;
  clerkUserId: string;
  sessionId: string | null;
}

interface ClerkEnv {
  CLERK_SECRET_KEY?: string;
  CLERK_JWT_KEY?: string;
  NEXT_PUBLIC_SITE_URL?: string;
}

function getClerkEnv(): Required<Pick<ClerkEnv, 'CLERK_SECRET_KEY'>> & ClerkEnv {
  // SAFETY: bindings are declared in wrangler secrets; see lib/cloudflare-env.supplemental.d.ts.
  // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: Cloudflare Env is string-indexed; narrow to known Clerk shape
  const e = env as unknown as ClerkEnv;
  if (!e.CLERK_SECRET_KEY) {
    throw new Error(
      'CLERK_SECRET_KEY is not set. Provision it with `wrangler secret put CLERK_SECRET_KEY`.'
    );
  }
  return { ...e, CLERK_SECRET_KEY: e.CLERK_SECRET_KEY };
}

let cachedClient: ClerkClient | null = null;
let cachedSecretKey: string | null = null;

export function getClerkClient(): ClerkClient {
  const { CLERK_SECRET_KEY, CLERK_JWT_KEY } = getClerkEnv();
  if (cachedClient && cachedSecretKey === CLERK_SECRET_KEY) {
    return cachedClient;
  }
  const clientOptions: Parameters<typeof createClerkClient>[0] = {
    secretKey: CLERK_SECRET_KEY,
    publishableKey: CLERK_PUBLISHABLE_KEY,
  };
  if (CLERK_JWT_KEY) clientOptions.jwtKey = CLERK_JWT_KEY;
  cachedClient = createClerkClient(clientOptions);
  cachedSecretKey = CLERK_SECRET_KEY;
  return cachedClient;
}

function getAuthorizedParties(): string[] {
  const { NEXT_PUBLIC_SITE_URL } = getClerkEnv();
  const parties = ['http://localhost:3000', 'http://localhost:8788'];
  if (NEXT_PUBLIC_SITE_URL) parties.push(NEXT_PUBLIC_SITE_URL);
  return parties;
}

export async function getSessionIdentity(request: Request): Promise<SessionIdentity | null> {
  try {
    const { CLERK_JWT_KEY } = getClerkEnv();
    const authenticateOptions: { authorizedParties: string[]; jwtKey?: string } = {
      authorizedParties: getAuthorizedParties(),
    };
    if (CLERK_JWT_KEY) authenticateOptions.jwtKey = CLERK_JWT_KEY;
    const auth = await getClerkClient().authenticateRequest(request, authenticateOptions);
    if (!auth.isAuthenticated) {
      return null;
    }
    const { userId: clerkUserId, sessionId, sessionClaims } = auth.toAuth();
    if (!clerkUserId) {
      return null;
    }
    // SAFETY: sessionClaims is JwtPayload (indexable); ext_id from own claim template is string when present.
    const claims = sessionClaims as Record<string, unknown> | null;
    const extId =
      typeof claims?.ext_id === 'string' && claims.ext_id.length > 0 ? claims.ext_id : null;
    return { userId: extId ?? clerkUserId, clerkUserId, sessionId: sessionId ?? null };
  } catch (error) {
    log('Auth').error('Clerk session verification failed:', error);
    return null;
  }
}

export async function getSessionIdentityFromHeaders(
  headers: Headers
): Promise<SessionIdentity | null> {
  const host = headers.get('host') ?? 'localhost';
  const proto = headers.get('x-forwarded-proto') ?? 'https';
  const request = new Request(`${proto}://${host}/`, { headers });
  return getSessionIdentity(request);
}

export async function revokeAllUserSessions(clerkUserId: string): Promise<void> {
  const client = getClerkClient();
  const sessions = await client.sessions.getSessionList({ userId: clerkUserId, status: 'active' });
  await Promise.allSettled(sessions.data.map((s) => client.sessions.revokeSession(s.id)));
}

export async function revokeSession(sessionId: string): Promise<void> {
  await getClerkClient().sessions.revokeSession(sessionId);
}
