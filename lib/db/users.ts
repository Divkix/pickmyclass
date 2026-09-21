import { type User, type UserJSON } from '@clerk/backend';
import { eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { TtlCache } from '@/lib/cache/ttl-cache';
import type { Database } from '@/lib/db';
import { users, userProfiles } from '@/lib/db/schema';
import { log } from '@/lib/log';

export interface UserVerificationState {
  email: string;
  email_confirmed_at: string | null;
}

const CACHE_TTL_MS = 30 * 1000;

const verificationCache = new TtlCache<UserVerificationState>(CACHE_TTL_MS, 100);

export function clearUserVerificationCache(): void {
  verificationCache.clear();
}

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

  // Never cache a miss: the mirror row can land (webhook / repair) at any
  // moment, and a cached null would keep a verified user gated for the TTL.
  if (cache && row) {
    verificationCache.set(userId, row);
  }

  return row ?? null;
}

interface NormalizedEmailAddress {
  id: string;
  emailAddress: string;
  verificationStatus: string | null;
}

interface NormalizedClerkUser {
  clerkUserId: string;
  externalId: string | null;
  email: string | null;
  emailVerified: boolean;
  createdAt: number | null;
  lastSignInAt: number | null;
  ageVerified: boolean;
  agreedToTerms: boolean;
}

function selectPrimaryEmailAddress(
  addresses: readonly NormalizedEmailAddress[],
  primaryEmailAddressId: string | null
): NormalizedEmailAddress | null {
  const selected =
    addresses.find((address) => address.id === primaryEmailAddressId) ?? addresses[0];

  return selected ?? null;
}

interface RegisterFlowPublicMetadata {
  age_verified?: unknown;
  agreed_to_terms?: unknown;
}

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

const clerkTimestampSchema = z.number();

function normalizeTimestamp(value: number | null | undefined): number | null {
  const parsed = clerkTimestampSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

function normalizeWebhookUser(user: UserJSON): NormalizedClerkUser {
  const createdAt = normalizeTimestamp(user.created_at);
  const lastSignInAt = normalizeTimestamp(user.last_sign_in_at);

  return normalizeClerkUser({
    clerkUserId: user.id,
    externalId: user.external_id ?? null,
    primaryEmailAddressId: user.primary_email_address_id ?? null,
    emailAddresses: user.email_addresses.map((address) => ({
      id: address.id,
      emailAddress: address.email_address,
      verificationStatus: address.verification?.status ?? null,
    })),
    createdAt,
    lastSignInAt,
    publicMetadata: user.public_metadata,
  });
}

function normalizeBackendUser(user: User): NormalizedClerkUser {
  const createdAt = normalizeTimestamp(user.createdAt);
  const lastSignInAt = normalizeTimestamp(user.lastSignInAt);

  return normalizeClerkUser({
    clerkUserId: user.id,
    externalId: user.externalId,
    primaryEmailAddressId: user.primaryEmailAddressId,
    emailAddresses: user.emailAddresses.map((address) => ({
      id: address.id,
      emailAddress: address.emailAddress,
      verificationStatus: address.verification?.status ?? null,
    })),
    createdAt,
    lastSignInAt,
    publicMetadata: user.publicMetadata,
  });
}

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

async function upsertUserMirror(
  db: Database,
  user: NormalizedClerkUser & { email: string }
): Promise<string> {
  const appUserId = user.externalId ?? user.clerkUserId;

  // One transaction: a `users` row without its `user_profiles` row (or the
  // reverse) is a half-written mirror that the gate reads as "unknown".
  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({
        id: appUserId,
        clerk_user_id: user.clerkUserId,
        email: user.email,
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
          email_confirmed_at: sql`case
            when ${users.email} <> excluded.email then excluded.email_confirmed_at
            else coalesce(${users.email_confirmed_at}, excluded.email_confirmed_at)
          end`,
          last_sign_in_at: sql`coalesce(excluded.last_sign_in_at, ${users.last_sign_in_at})`,
        },
      });

    const consentNow = new Date().toISOString();
    await tx
      .insert(userProfiles)
      .values({
        user_id: appUserId,
        age_verified_at: user.ageVerified ? consentNow : null,
        agreed_to_terms_at: user.agreedToTerms ? consentNow : null,
      })
      .onConflictDoNothing({ target: userProfiles.user_id });
  });

  return appUserId;
}

export async function syncUserMirrorFromClerkUser(db: Database, user: UserJSON): Promise<boolean> {
  const normalized = normalizeWebhookUser(user);
  const { email } = normalized;

  if (!email) return false;
  await upsertUserMirror(db, { ...normalized, email });

  return true;
}

export async function softDeleteUserById(db: Database, userId: string): Promise<number> {
  try {
    // Resolve both the app id and any mirror row carrying this Clerk id; the
    // profile FK means a Clerk id with no mirror row has nothing to disable.
    const mirrors = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, userId), eq(users.clerk_user_id, userId)));

    const targetIds = [...new Set(mirrors.map((row) => row.id))];

    // ponytail: a delete that beats every mirror write is a no-op — the profile
    // FK needs the users row and `users.email` is NOT NULL, so no placeholder
    // row is invented; Clerk already refuses the deleted identity at sign-in.
    if (targetIds.length === 0) return 0;

    // INSERT, not UPDATE: a later `user.created` retry only does
    // `ON CONFLICT DO NOTHING` on user_profiles, so the tombstone must exist as
    // a row — a half-written mirror (users row, no profile) would otherwise
    // come back enabled.
    await Promise.all(
      targetIds.map((targetId) =>
        db
          .insert(userProfiles)
          .values({
            user_id: targetId,
            is_disabled: true,
            disabled_at: sql`now()`,
            notifications_enabled: false,
            unsubscribed_at: sql`now()`,
          })
          .onConflictDoUpdate({
            target: userProfiles.user_id,
            set: {
              is_disabled: true,
              disabled_at: sql`coalesce(${userProfiles.disabled_at}, now())`,
              notifications_enabled: false,
              unsubscribed_at: sql`coalesce(${userProfiles.unsubscribed_at}, now())`,
            },
          })
      )
    );

    return targetIds.length;
  } catch (error) {
    log('Users').error('Failed to soft-delete user profile:', error);
    throw error;
  }
}

export async function repairUserMirror(
  db: Database,
  userId: string,
  clerkUser: User
): Promise<{ hasConsent: boolean } | null> {
  const existing = await readProfileConsent(db, userId);

  if (existing) return existing;

  const normalized = normalizeBackendUser(clerkUser);
  const { email } = normalized;

  if (!email) return null;
  // Read back the row the upsert actually wrote: with a stale `ext_id` claim
  // the canonical app id differs from the requested one.
  const appUserId = await upsertUserMirror(db, { ...normalized, email });

  const persisted = await readProfileConsent(db, appUserId);

  if (!persisted) {
    throw new Error(
      `repairUserMirror: user_profiles row for user ${appUserId} still missing after mirror upsert`
    );
  }

  return persisted;
}
