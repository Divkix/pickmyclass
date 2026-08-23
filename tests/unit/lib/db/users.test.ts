/**
 * Unit tests for the `users` mirror owner (issue #358).
 *
 * The module is the single owner of:
 * - the primary-email policy (primary-id match, then first-address fallback)
 * - deterministic mirror/profile race repair (`repairUserMirror`)
 * - the idempotent mirror upsert (Svix replays / out-of-order events)
 * - consent-on-profile-insert-only semantics
 * - the CCPA soft delete matching either the app id or the Clerk user id
 * - the cached/fresh edge read (`readUserVerification`)
 *
 * Seams are mocked — no real DB and no Clerk API:
 * - `@/lib/db/client` → `execute` / `queryOne`
 * - `@/lib/auth/clerk-session` → `getClerkClient().users.getUser`
 */
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { EmailAddressJSON, UserJSON, VerificationJSON } from '@clerk/backend';

// ---------------------------------------------------------------------------
// Fixture contracts — concrete stand-ins for the Clerk/DB wire types
// ---------------------------------------------------------------------------

/** Consent probe row read back from `user_profiles` (readProfileConsent). */
interface ProfileConsentRow {
  age_verified_at: string | null;
  agreed_to_terms_at: string | null;
}

/** Mirror row read back from `users` (the readUserVerification edge gate). */
interface MirrorVerificationRow {
  email: string;
  email_confirmed_at: string | null;
}

/** Every `queryOne` result this suite stubs; null when no row matched. */
type QueryOneRow = ProfileConsentRow | MirrorVerificationRow;

/**
 * Structural stand-in for the Backend-API `User` resource exposing exactly the
 * camelCase surface the repair path reads. Real Clerk backend resources cannot
 * be constructed without ~30 positional args.
 */
interface BackendUserDouble {
  id: string;
  externalId: string | null;
  primaryEmailAddressId: string | null;
  publicMetadata: UserJSON['public_metadata'];
  createdAt: number;
  lastSignInAt: number | null;
  emailAddresses: Array<{
    id: string;
    emailAddress: string;
    /** Repair policy reads only `verification?.status`. */
    verification: { status: VerificationJSON['status'] } | null;
  }>;
}

const { mockExecute, mockQueryOne, mockGetClerkClient, mockGetUser } = vi.hoisted(() => ({
  mockExecute: vi.fn<(sql: string, params?: unknown[]) => Promise<number>>(),
  mockQueryOne: vi.fn<(sql: string, params?: unknown[]) => Promise<QueryOneRow | null>>(),
  mockGetClerkClient: vi.fn(),
  mockGetUser: vi.fn<(userId: string) => Promise<BackendUserDouble>>(),
}));

vi.mock('@/lib/db/client', () => ({
  execute: mockExecute,
  queryOne: mockQueryOne,
}));

vi.mock('@/lib/auth/clerk-session', () => ({
  getClerkClient: mockGetClerkClient,
}));

import {
  clearUserVerificationCache,
  readUserVerification,
  repairUserMirror,
  softDeleteUserById,
  syncUserMirrorFromClerkUser,
} from '@/lib/db/users';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLERK_USER_ID = 'user_2abc123';
const MIGRATED_APP_ID = 'b7c9d1e2-3f40-4a51-8b62-old-supabase';
const EMAIL_PRIMARY_ID = 'idn_email_primary';
const EMAIL_SECONDARY_ID = 'idn_email_secondary';

const CREATED_AT_MS = 1_700_000_000_000;
const LAST_SIGN_IN_MS = 1_700_012_345_678;
const CREATED_AT_ISO = new Date(CREATED_AT_MS).toISOString();
const LAST_SIGN_IN_ISO = new Date(LAST_SIGN_IN_MS).toISOString();

/** ISO-8601 timestamp shape (what the upsert writes into timestamptz columns). */
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

type EmailStatus = 'verified' | 'unverified';

// Webhook/BAPI verification payloads only carry status/strategy/attempts/expire_at
// in practice, but VerificationJSON inherits the full ClerkResourceJSON envelope
// (object/id) and @clerk/backend v3 lacks a "verification" ObjectType literal, so
// the envelope below satisfies the SDK type with valid members — production code
// reads only `status`.
function emailVerification(status: EmailStatus): VerificationJSON {
  return {
    object: 'email_address',
    id: 'ver_fixture',
    status,
    strategy: 'email_code',
    attempts: null,
    expire_at: null,
  };
}

function emailAddress(id: string, address: string, status: EmailStatus | null): EmailAddressJSON {
  return {
    object: 'email_address',
    id,
    email_address: address,
    verification: status ? emailVerification(status) : null,
    linked_to: [],
  };
}

/** Full typed webhook payload with sensible defaults; tests override per case. */
function userJson(overrides: Partial<UserJSON> = {}): UserJSON {
  return {
    object: 'user',
    id: CLERK_USER_ID,
    username: null,
    first_name: null,
    last_name: null,
    image_url: 'https://img.clerk.com/default.png',
    has_image: false,
    primary_email_address_id: EMAIL_PRIMARY_ID,
    primary_phone_number_id: null,
    primary_web3_wallet_id: null,
    password_enabled: true,
    two_factor_enabled: false,
    totp_enabled: false,
    backup_code_enabled: false,
    email_addresses: [emailAddress(EMAIL_PRIMARY_ID, 'MixedCase@Example.COM', 'verified')],
    phone_numbers: [],
    web3_wallets: [],
    organization_memberships: null,
    external_accounts: [],
    enterprise_accounts: [],
    password_last_updated_at: null,
    public_metadata: {},
    private_metadata: {},
    unsafe_metadata: {},
    external_id: null,
    last_sign_in_at: LAST_SIGN_IN_MS,
    banned: false,
    locked: false,
    lockout_expires_in_seconds: null,
    verification_attempts_remaining: null,
    created_at: CREATED_AT_MS,
    updated_at: CREATED_AT_MS,
    last_active_at: null,
    create_organization_enabled: false,
    create_organizations_limit: null,
    delete_self_enabled: true,
    legal_accepted_at: null,
    locale: null,
    ...overrides,
  };
}

/** Build the Backend-API `User` double from a webhook-style payload. */
function backendUserFrom(json: UserJSON): BackendUserDouble {
  return {
    id: json.id,
    externalId: json.external_id,
    primaryEmailAddressId: json.primary_email_address_id,
    publicMetadata: json.public_metadata,
    createdAt: json.created_at,
    lastSignInAt: json.last_sign_in_at,
    emailAddresses: json.email_addresses.map((address) => ({
      id: address.id,
      emailAddress: address.email_address,
      verification: address.verification ? { status: address.verification.status } : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// SQL call inspection helpers
// ---------------------------------------------------------------------------

function normSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

interface ExecuteCall {
  sql: string;
  params: unknown[];
}

function executeCalls(): ExecuteCall[] {
  // SAFETY: mock signature fixes sql as first and params as second argument
  return mockExecute.mock.calls.map(([sql, params]) => ({
    sql: normSql(sql),
    params: params ?? [],
  }));
}

function mirrorUpserts(): ExecuteCall[] {
  return executeCalls().filter((call) => call.sql.startsWith('INSERT INTO users'));
}

function profileInserts(): ExecuteCall[] {
  return executeCalls().filter((call) => call.sql.startsWith('INSERT INTO user_profiles'));
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.clearAllMocks();
  clearUserVerificationCache();
  mockExecute.mockResolvedValue(1);
  mockQueryOne.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// syncUserMirrorFromClerkUser — sole primary-email policy + idempotent upsert
// ---------------------------------------------------------------------------

describe('syncUserMirrorFromClerkUser', () => {
  it('selects the address matching primary_email_address_id and lowercases it', async () => {
    const user = userJson({
      email_addresses: [
        emailAddress(EMAIL_PRIMARY_ID, 'First@Example.com', 'verified'),
        emailAddress(EMAIL_SECONDARY_ID, 'PRIMARY@Example.ORG', 'unverified'),
      ],
      primary_email_address_id: EMAIL_SECONDARY_ID,
    });

    await expect(syncUserMirrorFromClerkUser(user)).resolves.toBe(true);

    const [upsert] = mirrorUpserts();
    expect(upsert.params[0]).toBe(CLERK_USER_ID);
    expect(upsert.params[2]).toBe('primary@example.org');
  });

  it('falls back to the first address when no primary id matches', async () => {
    const user = userJson({
      email_addresses: [
        emailAddress('idn_a', 'Second.One@Example.net', 'unverified'),
        emailAddress('idn_b', 'ignored@Example.net', 'verified'),
      ],
      primary_email_address_id: null,
    });

    await expect(syncUserMirrorFromClerkUser(user)).resolves.toBe(true);

    expect(mirrorUpserts()[0].params[2]).toBe('second.one@example.net');
  });

  it('stamps a fresh confirmation timestamp for a verified address', async () => {
    const before = Date.now();
    await syncUserMirrorFromClerkUser(userJson());

    const confirmedAt = mirrorUpserts()[0].params[3];
    expect(confirmedAt).toMatch(ISO_LIKE);
    const parsed = Date.parse(String(confirmedAt));
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(Date.now());
  });

  it('leaves email_confirmed_at null for an unverified or unverified-payload address', async () => {
    await syncUserMirrorFromClerkUser(
      userJson({
        email_addresses: [emailAddress(EMAIL_PRIMARY_ID, 'pending@Example.com', 'unverified')],
      })
    );
    expect(mirrorUpserts()[0].params[3]).toBeNull();

    mockExecute.mockClear();
    await syncUserMirrorFromClerkUser(
      userJson({
        email_addresses: [emailAddress(EMAIL_PRIMARY_ID, 'no-ver@Example.com', null)],
      })
    );
    expect(mirrorUpserts()[0].params[3]).toBeNull();
  });

  it('uses external_id as the stable app id while preserving the Clerk id', async () => {
    const migrated = userJson({ external_id: MIGRATED_APP_ID });

    await syncUserMirrorFromClerkUser(migrated);

    const params = mirrorUpserts()[0].params;
    expect(params[0]).toBe(MIGRATED_APP_ID);
    expect(params[1]).toBe(CLERK_USER_ID);

    mockExecute.mockClear();
    const postCutover = userJson({ external_id: null });
    await syncUserMirrorFromClerkUser(postCutover);

    const fallbackParams = mirrorUpserts()[0].params;
    expect(fallbackParams[0]).toBe(CLERK_USER_ID);
    expect(fallbackParams[1]).toBe(CLERK_USER_ID);
  });

  it('maps created_at / last_sign_in_at onto ISO params, tolerating null sign-in', async () => {
    await syncUserMirrorFromClerkUser(userJson());

    const params = mirrorUpserts()[0].params;
    expect(params[4]).toBe(CREATED_AT_ISO);
    expect(params[5]).toBe(LAST_SIGN_IN_ISO);

    mockExecute.mockClear();
    await syncUserMirrorFromClerkUser(userJson({ last_sign_in_at: null }));

    const neverSignedIn = mirrorUpserts()[0].params;
    expect(neverSignedIn[4]).toBe(CREATED_AT_ISO);
    expect(neverSignedIn[5]).toBeNull();
  });

  it('writes consent timestamps on profile insert only from public_metadata booleans', async () => {
    await syncUserMirrorFromClerkUser(
      userJson({
        public_metadata: { age_verified: true, agreed_to_terms: true },
      })
    );

    const [insert] = profileInserts();
    expect(insert.params[0]).toBe(CLERK_USER_ID);
    const [ageAt, termsAt] = insert.params.slice(1, 3);
    expect(ageAt).toMatch(ISO_LIKE);
    expect(termsAt).toMatch(ISO_LIKE);
    expect(ageAt).toBe(termsAt);

    mockExecute.mockClear();
    await syncUserMirrorFromClerkUser(
      userJson({
        public_metadata: { age_verified: true, agreed_to_terms: false },
      })
    );
    expect(profileInserts()[0].params.slice(1, 3)).toEqual([expect.anything(), null]);

    mockExecute.mockClear();
    await syncUserMirrorFromClerkUser(userJson({ public_metadata: {} }));
    expect(profileInserts()[0].params.slice(1, 3)).toEqual([null, null]);
  });

  it('returns false without touching the DB when the payload has no email', async () => {
    const result = await syncUserMirrorFromClerkUser(
      userJson({
        email_addresses: [],
        primary_email_address_id: null,
      })
    );

    expect(result).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('replayed created payloads produce identical idempotent SQL and stable id/email', async () => {
    const payload = userJson({
      external_id: MIGRATED_APP_ID,
      email_addresses: [emailAddress(EMAIL_PRIMARY_ID, 'Migrated.User@Example.COM', 'verified')],
      public_metadata: { age_verified: true, agreed_to_terms: true },
    });

    await syncUserMirrorFromClerkUser(payload);
    await syncUserMirrorFromClerkUser(payload); // Svix replay

    const calls = executeCalls();
    expect(calls.length).toBe(4); // 2 statements × 2 deliveries

    // Replay produces identical SQL and every stable param. Only wall-clock
    // derived values (email_confirmed_at, consent stamps) may legitimately
    // advance between deliveries — those are compared by shape below instead
    // of byte equality, so this cannot flake when milliseconds tick over.
    const [firstMirror, secondMirror] = mirrorUpserts();
    expect(secondMirror.sql).toBe(firstMirror.sql);
    expect(secondMirror.params[0]).toBe(firstMirror.params[0]); // stable app id
    expect(secondMirror.params[1]).toBe(firstMirror.params[1]); // stable Clerk id
    expect(secondMirror.params[2]).toBe(firstMirror.params[2]); // lowercased email
    expect(secondMirror.params[4]).toBe(firstMirror.params[4]); // created_at from payload
    expect(secondMirror.params[5]).toBe(firstMirror.params[5]); // last_sign_in_at from payload

    const [firstProfile, secondProfile] = profileInserts();
    expect(secondProfile.sql).toBe(firstProfile.sql);
    expect(secondProfile.params[0]).toBe(firstProfile.params[0]); // stable app id

    expect(firstMirror.params[0]).toBe(MIGRATED_APP_ID); // stable app id across replays
    expect(firstMirror.params[2]).toBe('migrated.user@example.com');

    // Freshly stamped timestamps still land as ISO timestamptz values, and the
    // consent pair within a single delivery shares one stamp:
    for (const mirror of [firstMirror, secondMirror]) {
      expect(mirror.params[3]).toMatch(ISO_LIKE);
    }
    for (const profile of [firstProfile, secondProfile]) {
      expect(profile.params.slice(1, 3)).toEqual([
        expect.stringMatching(ISO_LIKE),
        expect.stringMatching(ISO_LIKE),
      ]);
      expect(profile.params[1]).toBe(profile.params[2]);
    }

    // Mirror upsert never duplicates rows and keeps the earliest verification:
    expect(firstMirror.sql).toContain('ON CONFLICT (id) DO UPDATE');
    expect(firstMirror.sql).toContain(
      'WHEN users.email <> EXCLUDED.email THEN EXCLUDED.email_confirmed_at'
    );
    expect(firstMirror.sql).toContain(
      'ELSE COALESCE(users.email_confirmed_at, EXCLUDED.email_confirmed_at)'
    );
    expect(firstMirror.sql).toContain('COALESCE(EXCLUDED.last_sign_in_at, users.last_sign_in_at)');
    expect(firstMirror.sql).toContain('COALESCE($5, NOW())');

    // Profile consent insert cannot overwrite already-recorded consent:
    expect(firstProfile.sql).toContain('ON CONFLICT (user_id) DO NOTHING');
  });
});

// ---------------------------------------------------------------------------
// repairUserMirror — deterministic race repair
// ---------------------------------------------------------------------------

describe('repairUserMirror', () => {
  const APP_USER_ID = MIGRATED_APP_ID;

  it('reports existing full consent without fetching Clerk or writing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      age_verified_at: '2026-01-01T00:00:00.000Z',
      agreed_to_terms_at: '2026-01-01T00:00:01.000Z',
    });

    const result = await repairUserMirror(APP_USER_ID, CLERK_USER_ID);

    expect(result).toEqual({ hasConsent: true });
    const [probe] = mockQueryOne.mock.calls;
    expect(normSql(probe?.[0])).toBe(
      'SELECT age_verified_at, agreed_to_terms_at FROM user_profiles WHERE user_id = $1'
    );
    expect(probe?.[1]).toEqual([APP_USER_ID]);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('requires BOTH consent timestamps before reporting hasConsent', async () => {
    mockQueryOne.mockResolvedValueOnce({
      age_verified_at: '2026-01-01T00:00:00.000Z',
      agreed_to_terms_at: null,
    });

    const result = await repairUserMirror(APP_USER_ID, CLERK_USER_ID);

    expect(result).toEqual({ hasConsent: false });
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('fetches Clerk only when the profile row is missing and upserts a verified user', async () => {
    const clerkUser = userJson({
      external_id: MIGRATED_APP_ID,
      public_metadata: { age_verified: true, agreed_to_terms: true },
    });
    mockGetUser.mockResolvedValueOnce(backendUserFrom(clerkUser));
    mockGetClerkClient.mockReturnValueOnce({ users: { getUser: mockGetUser } });
    // Pre-upsert probe misses the row; the post-upsert consent re-read sees it.
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      age_verified_at: '2026-01-01T00:00:00.000Z',
      agreed_to_terms_at: '2026-01-01T00:00:01.000Z',
    });

    const result = await repairUserMirror(APP_USER_ID, CLERK_USER_ID);

    expect(result).toEqual({ hasConsent: true });
    expect(mockGetClerkClient).toHaveBeenCalledTimes(1);
    expect(mockGetUser).toHaveBeenCalledTimes(1);
    expect(mockGetUser).toHaveBeenCalledWith(CLERK_USER_ID);

    const [mirror] = mirrorUpserts();
    expect(mirror.params).toEqual([
      APP_USER_ID,
      CLERK_USER_ID,
      'mixedcase@example.com',
      expect.stringMatching(ISO_LIKE), // observed verified state
      CREATED_AT_ISO,
      LAST_SIGN_IN_ISO,
    ]);
    expect(profileInserts()[0].params.slice(1, 3)).toEqual([
      expect.stringMatching(ISO_LIKE),
      expect.stringMatching(ISO_LIKE),
    ]);
  });

  it('upserts unverified users without metadata and reports inserted consent state', async () => {
    const clerkUser = userJson({
      email_addresses: [emailAddress(EMAIL_PRIMARY_ID, 'Unverified@Example.COM', 'unverified')],
      last_sign_in_at: null,
      public_metadata: {},
    });
    mockGetUser.mockResolvedValueOnce(backendUserFrom(clerkUser));
    mockGetClerkClient.mockReturnValueOnce({ users: { getUser: mockGetUser } });
    // Pre-upsert probe misses the row; the post-upsert consent re-read sees it.
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ age_verified_at: null, agreed_to_terms_at: null });

    const result = await repairUserMirror(CLERK_USER_ID, CLERK_USER_ID);

    expect(result).toEqual({ hasConsent: false });
    expect(mirrorUpserts()[0].params).toEqual([
      CLERK_USER_ID,
      CLERK_USER_ID,
      'unverified@example.com',
      null,
      CREATED_AT_ISO,
      null,
    ]);
    expect(profileInserts()[0].params.slice(1, 3)).toEqual([null, null]);
  });

  it('returns null without writing when the Clerk user has no email', async () => {
    mockGetUser.mockResolvedValueOnce(
      backendUserFrom(userJson({ email_addresses: [], primary_email_address_id: null }))
    );
    mockGetClerkClient.mockReturnValueOnce({ users: { getUser: mockGetUser } });

    const result = await repairUserMirror(CLERK_USER_ID, CLERK_USER_ID);

    expect(result).toBeNull();
    expect(mockGetUser).toHaveBeenCalledWith(CLERK_USER_ID);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns the consent persisted after an insert/conflict race, not Clerk metadata', async () => {
    // A concurrent webhook won the profile-insert race: our INSERT lands in
    // ON CONFLICT DO NOTHING, and the retained row disagrees with the
    // metadata proposed for insert. Repair must report the RETAINED state.
    const clerkUser = userJson({
      external_id: MIGRATED_APP_ID,
      public_metadata: { age_verified: true, agreed_to_terms: true },
    });
    mockGetUser.mockResolvedValueOnce(backendUserFrom(clerkUser));
    mockGetClerkClient.mockReturnValueOnce({ users: { getUser: mockGetUser } });
    mockQueryOne
      .mockResolvedValueOnce(null) // probe: nothing persisted yet
      .mockResolvedValueOnce({
        age_verified_at: '2026-01-01T00:00:00.000Z',
        agreed_to_terms_at: null, // concurrent writer recorded only age consent
      });

    const result = await repairUserMirror(APP_USER_ID, CLERK_USER_ID);

    expect(result).toEqual({ hasConsent: false });

    // The answer came from a re-read keyed by userId issued AFTER both writes:
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
    const [reRead] = mockQueryOne.mock.calls.slice(-1);
    expect(normSql(reRead?.[0])).toBe(
      'SELECT age_verified_at, agreed_to_terms_at FROM user_profiles WHERE user_id = $1'
    );
    expect(reRead?.[1]).toEqual([APP_USER_ID]);
    const lastWriteOrder = Math.max(...mockExecute.mock.invocationCallOrder);
    expect(mockQueryOne.mock.invocationCallOrder[1]).toBeGreaterThan(lastWriteOrder);
  });

  it('reports retained consent even when Clerk metadata claims none after the race', async () => {
    const clerkUser = userJson({
      external_id: MIGRATED_APP_ID,
      public_metadata: { age_verified: false, agreed_to_terms: false },
    });
    mockGetUser.mockResolvedValueOnce(backendUserFrom(clerkUser));
    mockGetClerkClient.mockReturnValueOnce({ users: { getUser: mockGetUser } });
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      age_verified_at: '2026-01-01T00:00:00.000Z',
      agreed_to_terms_at: '2026-01-01T00:00:01.000Z',
    });

    await expect(repairUserMirror(APP_USER_ID, CLERK_USER_ID)).resolves.toEqual({
      hasConsent: true,
    });
  });

  it('throws when the profile row is inexplicably absent after the upsert', async () => {
    const clerkUser = userJson({
      external_id: MIGRATED_APP_ID,
      public_metadata: { age_verified: true, agreed_to_terms: true },
    });
    mockGetUser.mockResolvedValueOnce(backendUserFrom(clerkUser));
    mockGetClerkClient.mockReturnValueOnce({ users: { getUser: mockGetUser } });
    mockQueryOne.mockResolvedValue(null); // probe AND post-write re-read both miss

    await expect(repairUserMirror(APP_USER_ID, CLERK_USER_ID)).rejects.toThrow();

    // Both writes were attempted before the failure surfaced:
    expect(executeCalls()).toHaveLength(2);
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Verified-state consistency between the two entry points (#358)
// ---------------------------------------------------------------------------

describe('webhook/repair verified-state consistency (#358)', () => {
  it.each([
    ['verified', 'verified' as const],
    ['unverified', 'unverified' as const],
  ])('%s identity yields the same mirror row through sync and repair', async (_label, status) => {
    const shared = {
      external_id: MIGRATED_APP_ID,
      email_addresses: [emailAddress(EMAIL_PRIMARY_ID, 'Shared@Example.COM', status)],
    };

    await syncUserMirrorFromClerkUser(userJson(shared));
    const syncedParams = mirrorUpserts()[0].params;

    mockExecute.mockClear();
    mockGetUser.mockResolvedValueOnce(backendUserFrom(userJson(shared)));
    mockGetClerkClient.mockReturnValueOnce({ users: { getUser: mockGetUser } });
    mockQueryOne
      .mockResolvedValueOnce(null) // no profile row yet
      .mockResolvedValueOnce({
        age_verified_at: '2026-01-01T00:00:00.000Z',
        agreed_to_terms_at: '2026-01-01T00:00:01.000Z',
      }); // post-write consent re-read
    await repairUserMirror(MIGRATED_APP_ID, CLERK_USER_ID);
    const repairedParams = mirrorUpserts()[0].params;

    // Stable id, Clerk id, lowercased email, created/last-sign-in identical:
    expect(repairedParams[0]).toBe(syncedParams[0]);
    expect(repairedParams[1]).toBe(syncedParams[1]);
    expect(repairedParams[2]).toBe(syncedParams[2]);
    expect(repairedParams[4]).toBe(syncedParams[4]);
    expect(repairedParams[5]).toBe(syncedParams[5]);

    // Observed verification agrees on presence and shape in both paths:
    if (status === 'verified') {
      expect(String(repairedParams[3])).toMatch(ISO_LIKE);
      expect(String(syncedParams[3])).toMatch(ISO_LIKE);
    } else {
      expect(repairedParams[3]).toBeNull();
      expect(syncedParams[3]).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// readUserVerification — cache/fresh split for the edge gate
// ---------------------------------------------------------------------------

describe('readUserVerification', () => {
  const ROW = { email: 'gate@example.com', email_confirmed_at: '2026-02-03T04:05:06.000Z' };
  const SELECT = 'SELECT email, email_confirmed_at FROM users WHERE id = $1';

  it('live reads map the row, or null when the mirror row does not exist yet', async () => {
    mockQueryOne.mockResolvedValueOnce(ROW);

    await expect(readUserVerification('u1', { cache: false })).resolves.toEqual(ROW);
    expect(normSql(mockQueryOne.mock.calls[0]?.[0])).toBe(SELECT);
    expect(mockQueryOne.mock.calls[0]?.[1]).toEqual(['u1']);

    mockQueryOne.mockResolvedValueOnce(null);
    await expect(readUserVerification('u1', { cache: false })).resolves.toBeNull();
  });

  it('serves subsequent cached reads from memory without re-querying', async () => {
    mockQueryOne.mockResolvedValue(ROW);

    const first = await readUserVerification('u1', { cache: true });
    const second = await readUserVerification('u1', { cache: true });

    expect(first).toEqual(ROW);
    expect(second).toEqual(ROW);
    expect(mockQueryOne).toHaveBeenCalledTimes(1);

    await expect(readUserVerification('u2', { cache: true })).resolves.toEqual(ROW);
    expect(mockQueryOne).toHaveBeenCalledTimes(2); // distinct key still queries
  });

  it('caches null as "unverified" until explicitly cleared', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(readUserVerification('u1', { cache: true })).resolves.toBeNull();

    // Webhook latency resolves and the row appears…
    mockQueryOne.mockResolvedValue(ROW);
    // …but the negative cache must still serve null within the TTL window:
    await expect(readUserVerification('u1', { cache: true })).resolves.toBeNull();
    expect(mockQueryOne).toHaveBeenCalledTimes(1);

    // Fresh reads bypass the negative cache:
    await expect(readUserVerification('u1', { cache: false })).resolves.toEqual(ROW);

    // And clearing (post-webhook invalidation seam) exposes the new state:
    clearUserVerificationCache();
    await expect(readUserVerification('u1', { cache: true })).resolves.toEqual(ROW);
  });
});

// ---------------------------------------------------------------------------
// softDeleteUserById — CCPA soft delete with dual-key match
// ---------------------------------------------------------------------------

describe('softDeleteUserById', () => {
  it('matches either the app id or the Clerk user id with a single bound param', async () => {
    mockExecute.mockResolvedValueOnce(2);

    await expect(softDeleteUserById(CLERK_USER_ID)).resolves.toBe(2);

    expect(executeCalls()).toHaveLength(1);
    const call = executeCalls()[0];
    expect(call.sql).toContain(
      'WHERE up.user_id = $1 OR up.user_id = (SELECT u.id FROM users u WHERE u.clerk_user_id = $1)'
    );
    expect(call.params).toEqual([CLERK_USER_ID]);
  });

  it('propagates DB failures after logging', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection reset'));

    await expect(softDeleteUserById(CLERK_USER_ID)).rejects.toThrow('connection reset');
  });
});
