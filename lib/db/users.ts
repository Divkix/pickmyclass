/**
 * `users` mirror table helpers — the local copy of Clerk-managed identities.
 *
 * The mirror exists so the ~10 SECURITY DEFINER functions can join emails
 * without a FAPI/BAPI call per query. Writes go through
 * `syncUserMirrorFromClerkUser` (webhook created/updated events) and
 * `repairUserMirror` (sign-in-time race repair); reads go through
 * `readUserVerification` (edge gate, email_confirmed_at for decideGate)
 * and admin queries.
 *
 * `users.id` is the stable app user id: the old Supabase UUID for migrated
 * users (via Clerk externalId), the Clerk user id for post-cutover users.
 *
 * Every persistence export takes a request-scoped {@link Database} first;
 * `clearUserVerificationCache` touches only memory and does not.
 */

import { type User, type UserJSON } from '@clerk/backend';
import { eq, inArray, or, sql } from 'drizzle-orm';

import { getClerkClient } from '@/lib/auth/clerk-session';
import { TtlCache } from '@/lib/cache/ttl-cache';
import type { Database } from '@/lib/db';
import { users, userProfiles } from '@/lib/db/schema';
import { log } from '@/lib/log';

/** Fields the edge gate needs from the mirror, keyed by users.id. */
export interface UserVerificationState {
  email: string;
  email_confirmed_at: string | null;
}

/** Per-isolate cache for the edge read (mirrors authorization-state's 30s TTL). */
const CACHE_TTL_MS = 30 * 1000;
const verificationCache = new TtlCache<UserVerificationState | null>(CACHE_TTL_MS, 100);

/** Clear the verification cache. Exposed for test isolation. Cache-only: no DB. */
export function clearUserVerificationCache(): void {
  verificationCache.clear();
}

/**
 * Read a user's email + verification timestamp from the mirror.
 * `{ cache: true }` is the edge read (up to 30s stale); `{ cache: false }`
 * always queries live. Returns null when the mirror row does not exist yet
 * (e.g. webhook latency right after signup) — callers must treat null as
 * "unverified" rather than an error.
 */
export async function readUserVerification(
  db: Database,
  userId: string,
  { cache }: { cache: boolean }
): Promise<UserVerificationState | null> {
  if (cache) {
    const cached = verificationCache.get(userId);
    if (cached !== undefined) return cached;
  }

  const [row] = await db
    .select({ email: users.email, email_confirmed_at: users.email_confirmed_at })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const state: UserVerificationState | null = row ?? null;

  if (cache) {
    verificationCache.set(userId, state);
  }
  return state;
}

/** Normalized Clerk email address — both payload casings reduce to this. */
interface NormalizedEmailAddress {
  id: string;
  /** Raw Clerk casing; lowercased exactly once, in normalizeClerkUser. */
  emailAddress: string;
  /** null when the address never went through verification. */
  verificationStatus: string | null;
}

/**
 * One internal source shape shared by webhook payloads (`UserJSON`) and
 * Backend user resources (`User`) — everything the mirror upsert needs,
 * independent of Clerk's snake_case vs camelCase payload variants.
 */
interface NormalizedClerkUser {
  clerkUserId: string;
  externalId: string | null;
  /** Lowercased selected primary email; null when the account has none. */
  email: string | null;
  /** Whether the selected address's verification status is 'verified'. */
  emailVerified: boolean;
  createdAt: number | null;
  lastSignInAt: number | null;
  /** Consent booleans from register-flow publicMetadata. */
  ageVerified: boolean;
  agreedToTerms: boolean;
}

/**
 * THE primary-email policy of this module (single implementation): prefer the
 * address whose id matches `primaryEmailAddressId`, falling back to the first
 * listed address. Returns null only when the account has no addresses at all.
 */
function selectPrimaryEmailAddress(
  addresses: readonly NormalizedEmailAddress[],
  primaryEmailAddressId: string | null
): NormalizedEmailAddress | null {
  const selected =
    addresses.find((address) => address.id === primaryEmailAddressId) ?? addresses[0];
  return selected ?? null;
}

/**
 * Normalize either Clerk user shape into one internal source shape using the
 * single primary-email policy above: lowercase the selected email exactly once
 * and derive verification from its verification status.
 */
/**
 * Register-flow consent flags as persisted in Clerk publicMetadata. Any other
 * Clerk payload publicMetadata shape is still assignable to this.
 */
interface RegisterFlowPublicMetadata {
  age_verified?: unknown;
  agreed_to_terms?: unknown;
}

/**
 * Read the two register-flow consent flags off publicMetadata: present and
 * literally `true`. Absent or non-true values are false.
 */
function readConsentFlags(metadata: RegisterFlowPublicMetadata | null | undefined) {
  return {
    ageVerified:
      metadata !== null &&
      metadata !== undefined &&
      'age_verified' in metadata &&
      metadata.age_verified === true,
    agreedToTerms:
      metadata !== null &&
      metadata !== undefined &&
      'agreed_to_terms' in metadata &&
      metadata.agreed_to_terms === true,
  };
}

function normalizeClerkUser(input: {
  clerkUserId: string;
  externalId: string | null;
  primaryEmailAddressId: string | null;
  emailAddresses: readonly NormalizedEmailAddress[];
  createdAt: number | null;
  lastSignInAt: number | null;
  publicMetadata: RegisterFlowPublicMetadata | null | undefined;
}): NormalizedClerkUser {
  const selected = selectPrimaryEmailAddress(input.emailAddresses, input.primaryEmailAddressId);
  return {
    clerkUserId: input.clerkUserId,
    externalId: input.externalId,
    email: selected ? selected.emailAddress.toLowerCase() : null,
    emailVerified: selected !== null && selected.verificationStatus === 'verified',
    createdAt: input.createdAt,
    lastSignInAt: input.lastSignInAt,
    ...readConsentFlags(input.publicMetadata),
  };
}
/** Adapter: snake_case webhook `UserJSON` payload → normalized shape. */
function normalizeWebhookUser(user: UserJSON): NormalizedClerkUser {
  return normalizeClerkUser({
    clerkUserId: user.id,
    externalId: user.external_id ?? null,
    primaryEmailAddressId: user.primary_email_address_id ?? null,
    emailAddresses: user.email_addresses.map((address) => ({
      id: address.id,
      emailAddress: address.email_address,
      verificationStatus: address.verification?.status ?? null,
    })),
    createdAt: typeof user.created_at === 'number' ? user.created_at : null,
    lastSignInAt: typeof user.last_sign_in_at === 'number' ? user.last_sign_in_at : null,
    publicMetadata: user.public_metadata,
  });
}

/** Adapter: camelCase Backend `User` resource → normalized shape. */
function normalizeBackendUser(user: User): NormalizedClerkUser {
  return normalizeClerkUser({
    clerkUserId: user.id,
    externalId: user.externalId,
    primaryEmailAddressId: user.primaryEmailAddressId,
    emailAddresses: user.emailAddresses.map((address) => ({
      id: address.id,
      emailAddress: address.emailAddress,
      verificationStatus: address.verification?.status ?? null,
    })),
    createdAt: typeof user.createdAt === 'number' ? user.createdAt : null,
    lastSignInAt: typeof user.lastSignInAt === 'number' ? user.lastSignInAt : null,
    publicMetadata: user.publicMetadata,
  });
}

/**
 * Read the consent timestamps actually persisted in the `user_profiles` row
 * for `userId`. Returns null when no row exists yet; otherwise reports
 * whether both consent timestamps are set. This is the single probe used by
 * the existing-profile fast path and by post-write verification, so returned
 * consent always reflects retained DB state rather than webhook metadata.
 */
async function readProfileConsent(
  db: Database,
  userId: string
): Promise<{ hasConsent: boolean } | null> {
  const [profile] = await db
    .select({
      age_verified_at: userProfiles.age_verified_at,
      agreed_to_terms_at: userProfiles.agreed_to_terms_at,
    })
    .from(userProfiles)
    .where(eq(userProfiles.user_id, userId))
    .limit(1);
  if (!profile) return null;
  return {
    hasConsent: profile.age_verified_at !== null && profile.agreed_to_terms_at !== null,
  };
}

/**
 * Sole writer for the users mirror row and its 1:1 user_profiles row
 * (replaces the dropped on_auth_user_created trigger). Keeps the original
 * two-statement idempotent SQL semantics via Drizzle upserts: the mirror
 * upsert resets verification when the email changed and keeps the earliest
 * confirmed timestamp otherwise; consent timestamps are written only on
 * insert and only when the corresponding metadata boolean was true — later
 * updates never overwrite existing consent. Safe for Svix retries and
 * out-of-order created/updated delivery. Returns nothing: what actually
 * persisted (e.g. after an insert/conflict race with a concurrent writer)
 * must be read back from `user_profiles`, never inferred from the metadata
 * this call proposed for insert.
 *
 * Callers must guard a non-null selected email first (both entry points skip
 * email-less accounts); the `email: string` parameter encodes that invariant.
 */
async function upsertUserMirror(
  db: Database,
  user: NormalizedClerkUser & { email: string }
): Promise<void> {
  // Stable app user id: externalId if set (migrated), else the Clerk user id.
  const appUserId = user.externalId ?? user.clerkUserId;

  await db
    .insert(users)
    .values({
      id: appUserId,
      clerk_user_id: user.clerkUserId,
      email: user.email,
      // An observed-verified address stamps a fresh confirmation timestamp;
      // unverified addresses persist NULL so the CASE below can reset it.
      email_confirmed_at: user.emailVerified ? new Date().toISOString() : null,
      created_at: user.createdAt !== null ? new Date(user.createdAt).toISOString() : sql`now()`,
      last_sign_in_at:
        user.lastSignInAt !== null ? new Date(user.lastSignInAt).toISOString() : null,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        clerk_user_id: sql`excluded.clerk_user_id`,
        email: sql`excluded.email`,
        // An email change resets verification to the new address's status;
        // otherwise keep the earliest confirmed timestamp.
        email_confirmed_at: sql`case
          when ${users.email} <> excluded.email then excluded.email_confirmed_at
          else coalesce(${users.email_confirmed_at}, excluded.email_confirmed_at)
        end`,
        last_sign_in_at: sql`coalesce(excluded.last_sign_in_at, ${users.last_sign_in_at})`,
      },
    });

  const consentNow = new Date().toISOString();
  await db
    .insert(userProfiles)
    .values({
      user_id: appUserId,
      age_verified_at: user.ageVerified ? consentNow : null,
      agreed_to_terms_at: user.agreedToTerms ? consentNow : null,
    })
    .onConflictDoNothing({ target: userProfiles.user_id });
}

/**
 * Upsert the mirror + profile rows from a Clerk webhook `UserJSON` payload
 * (user.created / user.updated). Returns false when the account has no email
 * addresses so the caller can skip the event instead of writing a mirror row
 * that could never verify against anything.
 */
export async function syncUserMirrorFromClerkUser(db: Database, user: UserJSON): Promise<boolean> {
  const normalized = normalizeWebhookUser(user);
  const { email } = normalized;
  if (!email) return false;
  await upsertUserMirror(db, { ...normalized, email });
  return true;
}

/**
 * CCPA-consistent soft delete driven by a Clerk `user.deleted` webhook:
 * disable the profile and suppress all notifications. The users row stays
 * (FK target for historical data); the 30-day purge is a separate process.
 * Matches on either the app id or the Clerk user id, because user.deleted
 * only carries the Clerk id and migrated rows are keyed by the old UUID.
 * Returns the number of profiles disabled.
 */
export async function softDeleteUserById(db: Database, userId: string): Promise<number> {
  try {
    const result = await db
      .update(userProfiles)
      .set({
        is_disabled: true,
        disabled_at: sql`coalesce(${userProfiles.disabled_at}, now())`,
        notifications_enabled: false,
        unsubscribed_at: sql`coalesce(${userProfiles.unsubscribed_at}, now())`,
      })
      .where(
        or(
          eq(userProfiles.user_id, userId),
          inArray(
            userProfiles.user_id,
            db.select({ id: users.id }).from(users).where(eq(users.clerk_user_id, userId))
          )
        )
      );
    return result.count;
  } catch (error) {
    log('Users').error('Failed to soft-delete user profile:', error);
    throw error;
  }
}

/**
 * Repair the (short) race where a user authenticates before their
 * user.created webhook lands — most likely for Google OAuth sign-ups — and
 * report the profile's consent state so callers need no probe of their own.
 *
 * When the profile row already exists, returns its consent state without
 * touching Clerk. Otherwise fetches the Backend user via `getClerkClient`,
 * writes both rows with the user's actual verified status, timestamps, and
 * metadata (never null stubs), then re-reads `user_profiles` so the returned
 * consent is what actually persisted — a concurrent webhook may have won the
 * insert race with different metadata. Returns null only when the Clerk
 * account has no primary email. Throws if the profile row is still absent
 * after the upsert; route error handling owns recovery from there.
 */
export async function repairUserMirror(
  db: Database,
  userId: string,
  clerkUserId: string
): Promise<{ hasConsent: boolean } | null> {
  const existing = await readProfileConsent(db, userId);
  if (existing) return existing;

  const clerkUser = await getClerkClient().users.getUser(clerkUserId);
  const normalized = normalizeBackendUser(clerkUser);
  const { email } = normalized;
  if (!email) return null;
  await upsertUserMirror(db, { ...normalized, email });

  const persisted = await readProfileConsent(db, userId);
  if (!persisted) {
    throw new Error(
      `repairUserMirror: user_profiles row for user ${userId} still missing after mirror upsert`
    );
  }
  return persisted;
}
