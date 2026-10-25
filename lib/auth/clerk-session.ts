/**
 * Clerk session seam — the only module that talks to Clerk for identity.
 *
 * Server-only: imported by request middleware, API handlers, and page server functions. Never
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

import { type ClerkClient, type User, createClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import { Effect } from "effect";
import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  ClerkCallFailed,
  ClerkCallTimedOut,
  SessionRevocationIncomplete,
} from "@/lib/auth/clerk-errors";
import { CLERK_REQUEST_TIMEOUT_MS, CLERK_SESSION_REVOKE_LIMIT } from "@/lib/config";
import { CLERK_PUBLISHABLE_KEY } from "@/lib/clerk/config";
import { externalCall } from "@/lib/effect/external-call";
import { errorFields, log } from "@/lib/log";

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

const clerkEnvSchema = z.object({
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_JWT_KEY: z.string().optional(),
  NEXT_PUBLIC_SITE_URL: z.string().optional(),
});

function getClerkEnv(): Required<Pick<ClerkEnv, "CLERK_SECRET_KEY">> & ClerkEnv {
  // SAFETY: bindings are declared in wrangler secrets; see lib/cloudflare-env.supplemental.d.ts.
  const e = clerkEnvSchema.parse(env);

  if (!e.CLERK_SECRET_KEY) {
    throw new Error(
      "CLERK_SECRET_KEY is not set. Provision it with `wrangler secret put CLERK_SECRET_KEY`.",
    );
  }

  return { ...e, CLERK_SECRET_KEY: e.CLERK_SECRET_KEY };
}

/**
 * Built per call: the client holds no connection, and a module-level instance
 * would outlive the request that supplied its keys.
 */
function buildClerkClient(): ClerkClient {
  const { CLERK_SECRET_KEY, CLERK_JWT_KEY } = getClerkEnv();

  const clientOptions: Parameters<typeof createClerkClient>[0] = {
    secretKey: CLERK_SECRET_KEY,
    publishableKey: CLERK_PUBLISHABLE_KEY,
  };

  if (CLERK_JWT_KEY) clientOptions.jwtKey = CLERK_JWT_KEY;

  return createClerkClient(clientOptions);
}

/** The Backend API answers with an HTTP status; anything else is a transport failure. */
function failureStatus(error: Error): number | undefined {
  return isClerkAPIResponseError(error) ? error.status : undefined;
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === undefined || status === 429 || status >= 500;
}

/** Every Clerk network call goes through here: an explicit timeout and typed failures. */
function clerkCall<A>(operation: string, attempt: () => Promise<A>): Promise<A> {
  return Effect.runPromise(
    externalCall(
      attempt,
      CLERK_REQUEST_TIMEOUT_MS,
      (error) => {
        const status = failureStatus(error);

        return new ClerkCallFailed({
          message: error.message,
          operation,
          ...(status !== undefined && { status }),
          retryable: isRetryableStatus(status),
          cause: error,
        });
      },
      () =>
        new ClerkCallTimedOut({
          message: `Clerk ${operation} timed out after ${CLERK_REQUEST_TIMEOUT_MS}ms`,
          operation,
          timeoutMs: CLERK_REQUEST_TIMEOUT_MS,
          retryable: true,
        }),
    ),
  );
}

function getAuthorizedParties(): string[] {
  const { NEXT_PUBLIC_SITE_URL } = getClerkEnv();
  const parties = ["http://localhost:3000", "http://localhost:8788"];

  if (NEXT_PUBLIC_SITE_URL) parties.push(NEXT_PUBLIC_SITE_URL);

  return parties;
}

export async function getSessionIdentity(request: Request): Promise<SessionIdentity | null> {
  try {
    const { CLERK_JWT_KEY } = getClerkEnv();

    const authorizedParties = getAuthorizedParties();

    const authenticateOptions = CLERK_JWT_KEY
      ? { authorizedParties, jwtKey: CLERK_JWT_KEY }
      : { authorizedParties };

    const auth = await clerkCall("authenticateRequest", () =>
      buildClerkClient().authenticateRequest(request, authenticateOptions),
    );

    if (!auth.isAuthenticated) {
      return null;
    }

    const { userId: clerkUserId, sessionId, sessionClaims } = auth.toAuth();

    if (!clerkUserId) {
      return null;
    }

    // ext_id is this app's own claim-template value, used verbatim (no trim) as the identity PK.
    const extIdClaim = z.string().min(1).nullish().safeParse(sessionClaims?.ext_id);

    const extId = extIdClaim.success ? (extIdClaim.data ?? null) : null;

    return { userId: extId ?? clerkUserId, clerkUserId, sessionId: sessionId ?? null };
  } catch (error) {
    log("Auth").error("Clerk session verification failed", errorFields(error));

    return null;
  }
}

/**
 * Revokes the user's active sessions, then rechecks: a session still active (a failed revoke,
 * one created meanwhile, or one past `CLERK_SESSION_REVOKE_LIMIT`) throws instead of being dropped.
 */
export async function revokeAllUserSessions(clerkUserId: string): Promise<void> {
  const client = buildClerkClient();

  const listActive = (limit: number) =>
    clerkCall("sessions.getSessionList", () =>
      client.sessions.getSessionList({ userId: clerkUserId, status: "active", limit }),
    );

  const sessions = await listActive(CLERK_SESSION_REVOKE_LIMIT);

  const results = await Promise.allSettled(
    sessions.data.map((session) =>
      clerkCall("sessions.revokeSession", () => client.sessions.revokeSession(session.id)),
    ),
  );

  for (const result of results) {
    if (result.status === "fulfilled") continue;
    log("Auth").error("Failed to revoke Clerk session", {
      clerk_user_id: clerkUserId,
      ...errorFields(result.reason),
    });
  }

  const { totalCount: left } = await listActive(1);

  if (left > 0) {
    throw new SessionRevocationIncomplete({
      message: `${left} of ${sessions.totalCount} Clerk sessions still active after sign-out`,
      failed: left,
      total: sessions.totalCount,
      retryable: true,
    });
  }
}

export async function revokeSession(sessionId: string): Promise<void> {
  await clerkCall("sessions.revokeSession", () =>
    buildClerkClient().sessions.revokeSession(sessionId),
  );
}

export function getClerkUser(clerkUserId: string): Promise<User> {
  return clerkCall("users.getUser", () => buildClerkClient().users.getUser(clerkUserId));
}

/** Deletes the Clerk identity (email, name, credentials). Already gone (404) counts as done. */
export async function deleteClerkUser(clerkUserId: string): Promise<void> {
  try {
    await clerkCall("users.deleteUser", () => buildClerkClient().users.deleteUser(clerkUserId));
  } catch (error) {
    if (error instanceof ClerkCallFailed && error.status === 404) return;

    throw error;
  }
}
