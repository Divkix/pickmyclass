/**
 * `users` mirror table helpers — the local copy of Clerk-managed identities.
 *
 * The mirror exists so the ~10 SECURITY DEFINER functions can join emails
 * without a FAPI/BAPI call per query. It is written by the Clerk webhook
 * route (`/api/webhooks/clerk`) and read by the edge gate (email_confirmed_at
 * for decideGate) and admin pages.
 *
 * `users.id` is the stable app user id: the old Supabase UUID for migrated
 * users (via Clerk externalId), the Clerk user id for post-cutover users.
 */

import { TtlCache } from '@/lib/cache/ttl-cache';
import { execute, queryOne } from '@/lib/db/client';
import type { UserMirrorRow } from '@/lib/db/types';
import { log } from '@/lib/log';

/** Fields the edge gate needs from the mirror, keyed by users.id. */
export interface UserVerificationState {
  email: string;
  email_confirmed_at: string | null;
}

/** Per-isolate cache for the edge read (mirrors authorization-state's 30s TTL). */
const CACHE_TTL_MS = 30 * 1000;
const verificationCache = new TtlCache<UserVerificationState | null>(CACHE_TTL_MS, 100);

/** Clear the verification cache. Exposed for test isolation. */
export function clearUserVerificationCache(): void {
  verificationCache.clear();
}

/**
 * Invalidate the cached verification row for a user. Call after writing
 * `email_confirmed_at` (e.g. the email-verified confirm route) so the next
 * edge-gate read re-queries instead of serving a stale unverified decision.
 */
export function invalidateUserVerification(userId: string): boolean {
  return verificationCache.delete(userId);
}

/**
 * Read a user's email + verification timestamp from the mirror.
 * `{ cache: true }` is the edge read (up to 30s stale); `{ cache: false }`
 * always queries live. Returns null when the mirror row does not exist yet
 * (e.g. webhook latency right after signup) — callers must treat null as
 * "unverified" rather than an error.
 */
export async function readUserVerification(
  userId: string,
  { cache }: { cache: boolean }
): Promise<UserVerificationState | null> {
  if (cache) {
    const cached = verificationCache.get(userId);
    if (cached !== undefined) return cached;
  }

  const row = await queryOne<Pick<UserMirrorRow, 'email' | 'email_confirmed_at'>>(
    'SELECT email, email_confirmed_at FROM users WHERE id = $1',
    [userId]
  );
  const state = row ? { email: row.email, email_confirmed_at: row.email_confirmed_at } : null;

  if (cache) {
    verificationCache.set(userId, state);
  }
  return state;
}

export interface ClerkWebhookUserFields {
  /** Stable app user id: externalId if set (migrated), else the Clerk user id. */
  id: string;
  /** Clerk's own user id — stored so user.deleted (Clerk-id-only) resolves. */
  clerkUserId: string;
  email: string;
  emailConfirmedAt: Date | null;
  createdAt: Date | null;
  lastSignInAt: Date | null;
  /** Consent booleans from createUser publicMetadata (register flow). */
  ageVerified: boolean;
  agreedToTerms: boolean;
}

/**
 * Upsert the users mirror row from a Clerk webhook payload, and ensure the
 * 1:1 user_profiles row exists (replaces the dropped on_auth_user_created
 * trigger). Consent timestamps are written only on insert and only when the
 * corresponding metadata boolean was true — later updates never overwrite
 * existing consent. Idempotent; safe for Svix retries and out-of-order
 * created/updated delivery.
 */
export async function upsertUserFromClerkWebhook(fields: ClerkWebhookUserFields): Promise<void> {
  await execute(
    `INSERT INTO users (id, clerk_user_id, email, email_confirmed_at, created_at, last_sign_in_at)
     VALUES ($1, $2, $3, $4, COALESCE($5, NOW()), $6)
     ON CONFLICT (id) DO UPDATE SET
       clerk_user_id = EXCLUDED.clerk_user_id,
       email = EXCLUDED.email,
       -- An email change resets verification to the new address's status;
       -- otherwise keep the earliest confirmed timestamp.
       email_confirmed_at = CASE
         WHEN users.email <> EXCLUDED.email THEN EXCLUDED.email_confirmed_at
         ELSE COALESCE(users.email_confirmed_at, EXCLUDED.email_confirmed_at)
       END,
       last_sign_in_at = COALESCE(EXCLUDED.last_sign_in_at, users.last_sign_in_at)`,
    [
      fields.id,
      fields.clerkUserId,
      fields.email,
      fields.emailConfirmedAt?.toISOString() ?? null,
      fields.createdAt?.toISOString() ?? null,
      fields.lastSignInAt?.toISOString() ?? null,
    ]
  );

  const consentNow = new Date().toISOString();
  await execute(
    `INSERT INTO user_profiles (user_id, age_verified_at, agreed_to_terms_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO NOTHING`,
    [fields.id, fields.ageVerified ? consentNow : null, fields.agreedToTerms ? consentNow : null]
  );
}

/**
 * Record a successful email verification directly (bypasses webhook latency).
 * Called by /api/auth/email-verified after the server confirms the verified
 * status with Clerk, so the edge gate stops bouncing the user to /verify-email.
 */
export async function markEmailVerified(userId: string): Promise<void> {
  await execute(
    'UPDATE users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()) WHERE id = $1',
    [userId]
  );
  invalidateUserVerification(userId);
}

/**
 * CCPA-consistent soft delete driven by a Clerk `user.deleted` webhook:
 * disable the profile and suppress all notifications. The users row stays
 * (FK target for historical data); the 30-day purge is a separate process.
 * Matches on either the app id or the Clerk user id, because user.deleted
 * only carries the Clerk id and migrated rows are keyed by the old UUID.
 */
export async function softDeleteUserById(userId: string): Promise<number> {
  try {
    return await execute(
      `UPDATE user_profiles up
       SET is_disabled = true,
           disabled_at = COALESCE(disabled_at, NOW()),
           notifications_enabled = false,
           unsubscribed_at = COALESCE(unsubscribed_at, NOW())
       WHERE up.user_id = $1
          OR up.user_id = (SELECT u.id FROM users u WHERE u.clerk_user_id = $1)`,
      [userId]
    );
  } catch (error) {
    log('Users').error('Failed to soft-delete user profile:', error);
    throw error;
  }
}

/**
 * Ensure the mirror + profile rows exist for a signed-in user. Repairs the
 * (short) race where a user authenticates before their user.created webhook
 * lands — most likely for Google OAuth sign-ups. Needs the email, so callers
 * pass it from the Clerk user object they already fetched.
 */
export async function ensureUserMirror(
  userId: string,
  clerkUserId: string,
  email: string
): Promise<void> {
  await upsertUserFromClerkWebhook({
    id: userId,
    clerkUserId,
    email,
    emailConfirmedAt: null,
    createdAt: null,
    lastSignInAt: null,
    ageVerified: false,
    agreedToTerms: false,
  });
}
