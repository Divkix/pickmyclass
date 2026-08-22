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

/**
 * The verified identity for one request.
 */
export interface SessionIdentity {
  /**
   * Stable app user id — `ext_id` claim (old Supabase UUID for migrated users,
   * Clerk user id for new ones). This is `users.id` everywhere in the DB.
   */
  userId: string;
  /** Clerk's own user id (the `sub` claim) — required for Clerk Backend API calls. */
  clerkUserId: string;
  /** Clerk session id (`sid` claim), used for targeted session revocation. */
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

/** Per-isolate cached client (module scope persists across requests in an isolate). */
let cachedClient: ClerkClient | null = null;
let cachedSecretKey: string | null = null;

/**
 * Get the cached Clerk Backend client. `jwtKey` (PEM) is passed at creation so
 * `authenticateRequest` verifies networklessly; the secret key powers Backend
 * API calls (createUser, verifyPassword, signInTokens, session revocation).
 */
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

/**
 * Origins allowed to present session tokens (the `azp` claim). Browser session
 * tokens always carry azp; tokens minted via the ticket flow carry the origin
 * that redeemed them.
 */
function getAuthorizedParties(): string[] {
  const { NEXT_PUBLIC_SITE_URL } = getClerkEnv();
  const parties = ['http://localhost:3000', 'http://localhost:8788'];
  if (NEXT_PUBLIC_SITE_URL) parties.push(NEXT_PUBLIC_SITE_URL);
  return parties;
}

/**
 * Verify the request's Clerk session (networkless) and return the identity.
 * Returns null when unauthenticated — callers map that to their own
 * redirect/401 semantics. Never throws on auth failure; logs and returns null.
 */
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
    // SAFETY: sessionClaims is JwtPayload (indexable); ext_id comes from our own
    // claim template and is a string when present.
    const claims = sessionClaims as Record<string, unknown> | null;
    const extId =
      typeof claims?.ext_id === 'string' && claims.ext_id.length > 0 ? claims.ext_id : null;
    return { userId: extId ?? clerkUserId, clerkUserId, sessionId: sessionId ?? null };
  } catch (error) {
    log('Auth').error('Clerk session verification failed:', error);
    return null;
  }
}

/**
 * RSC/server-component variant: Next gives read-only headers, not a Request.
 * authenticateRequest only needs the URL (for clerkUrl derivation) and headers
 * (cookie parsing), so a minimal reconstructed Request suffices.
 */
export async function getSessionIdentityFromHeaders(
  headers: Headers
): Promise<SessionIdentity | null> {
  const host = headers.get('host') ?? 'localhost';
  const proto = headers.get('x-forwarded-proto') ?? 'https';
  const request = new Request(`${proto}://${host}/`, { headers });
  return getSessionIdentity(request);
}

/**
 * Revoke all of a user's active sessions (the Clerk equivalent of a global
 * signOut). Used when an account is disabled at login or deleted (CCPA).
 * Best-effort by design: revocation only takes effect once each session's
 * short-lived JWT expires, so callers MUST also clear session cookies on the
 * current response when a browser session is in scope.
 */
export async function revokeAllUserSessions(clerkUserId: string): Promise<void> {
  const client = getClerkClient();
  const sessions = await client.sessions.getSessionList({ userId: clerkUserId, status: 'active' });
  await Promise.allSettled(sessions.data.map((s) => client.sessions.revokeSession(s.id)));
}

/**
 * Revoke one session by id (targeted sign-out of the current browser session).
 */
export async function revokeSession(sessionId: string): Promise<void> {
  await getClerkClient().sessions.revokeSession(sessionId);
}
