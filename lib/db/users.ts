import { type User, type UserJSON } from '@clerk/backend';
import { eq, inArray, or, sql } from 'drizzle-orm';

import { TtlCache } from '@/lib/cache/ttl-cache';
import type { Database } from '@/lib/db';
import { users, userProfiles } from '@/lib/db/schema';
import { log } from '@/lib/log';

export interface UserVerificationState {
  email: string;
  email_confirmed_at: string | null;
}

const CACHE_TTL_MS = 30 * 1000;
const verificationCache = new TtlCache<UserVerificationState | null>(CACHE_TTL_MS, 100);

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
  const state: UserVerificationState | null = row ?? null;

  if (cache) {
    verificationCache.set(userId, state);
  }
  return state;
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
): Promise<void> {
  const appUserId = user.externalId ?? user.clerkUserId;

  await db
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
  await db
    .insert(userProfiles)
    .values({
      user_id: appUserId,
      age_verified_at: user.ageVerified ? consentNow : null,
      agreed_to_terms_at: user.agreedToTerms ? consentNow : null,
    })
    .onConflictDoNothing({ target: userProfiles.user_id });
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
  await upsertUserMirror(db, { ...normalized, email });

  const persisted = await readProfileConsent(db, userId);
  if (!persisted) {
    throw new Error(
      `repairUserMirror: user_profiles row for user ${userId} still missing after mirror upsert`
    );
  }
  return persisted;
}
