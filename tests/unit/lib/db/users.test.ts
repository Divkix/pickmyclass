import type { EmailAddressJSON, User, UserJSON, VerificationJSON } from '@clerk/backend';
import { SQL } from 'drizzle-orm';
import { PgDialect, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import type { Database } from '@/lib/db';
import { users, userProfiles } from '@/lib/db/schema';
import {
  clearUserVerificationCache,
  readUserVerification,
  repairUserMirror,
  softDeleteUserById,
  syncUserMirrorFromClerkUser,
} from '@/lib/db/users';

type RecordedValue = string | number | boolean | null | SQL;

interface RecordedRowMap {
  [column: string]: RecordedValue;
}

interface ProjectionMap {
  [column: string]: PgColumn | SQL;
}

type SelectRow = { [column: string]: string | null };

interface SelectOp {
  method: 'select';
  projection: ProjectionMap;
  table: PgTable | undefined;
  where: SQL | undefined;
  limit: number | null;
}

interface InsertOp {
  method: 'insert';
  table: PgTable;
  values: RecordedRowMap;
  conflict: { target?: PgColumn; set?: RecordedRowMap } | null;
}

interface UpdateOp {
  method: 'update';
  table: PgTable;
  set: RecordedRowMap;
  where: SQL | undefined;
}

type Op = SelectOp | InsertOp | UpdateOp;

interface BuilderRecorder {
  select(projection: ProjectionMap): {
    from(table: PgTable): {
      where(where: SQL): {
        limit(limit: number): Promise<SelectRow[]>;
      };
    };
  };
  insert(table: PgTable): {
    values(values: RecordedRowMap): {
      onConflictDoNothing(config?: { target?: PgColumn }): Promise<never[]>;
      onConflictDoUpdate(config: { target?: PgColumn; set: RecordedRowMap }): Promise<never[]>;
    };
  };
  update(table: PgTable): {
    set(patch: RecordedRowMap): {
      where(where: SQL): Promise<{ count: number }>;
    };
  };
}

type UsersSeamDb = Database | BuilderRecorder;

function asDatabaseHandle(seam: UsersSeamDb): Database {
  return seam as Database;
}

interface DbDouble {
  db: Database;
  ops(): Op[];
  selects(): SelectOp[];
  inserts(): InsertOp[];
  updates(): UpdateOp[];
  mirrorUpserts(): InsertOp[];
  profileInserts(): InsertOp[];
  nextRows(rows?: SelectRow[]): void;
  nextUpdateCount(count: number): void;
  failNextUpdate(error: Error): void;
}

function createDbDouble(): DbDouble {
  const ops: Op[] = [];
  const selectResults: Array<Promise<SelectRow[]> | SelectRow[]> = [];
  const updateResults: Array<Promise<{ count: number }> | { count: number }> = [];

  const raw: BuilderRecorder = {
    select: (projection: ProjectionMap) => {
      const op: SelectOp = {
        method: 'select',
        projection,
        table: undefined,
        where: undefined,
        limit: null,
      };
      ops.push(op);
      return {
        from: (table: PgTable) => {
          op.table = table;
          return {
            where: (where: SQL) => {
              op.where = where;
              return {
                limit: (limit: number) => {
                  op.limit = limit;
                  return Promise.resolve(selectResults.shift() ?? []);
                },
              };
            },
          };
        },
      };
    },
    insert: (table: PgTable) => {
      const op: InsertOp = { method: 'insert', table, values: {}, conflict: null };
      ops.push(op);
      return {
        values: (values: RecordedRowMap) => {
          op.values = values;
          return {
            onConflictDoNothing: (config: { target?: PgColumn } = {}) => {
              op.conflict = config;
              return Promise.resolve([]);
            },
            onConflictDoUpdate: (config: { target?: PgColumn; set: RecordedRowMap }) => {
              op.conflict = config;
              return Promise.resolve([]);
            },
          };
        },
      };
    },
    update: (table: PgTable) => {
      const op: UpdateOp = { method: 'update', table, set: {}, where: undefined };
      ops.push(op);
      return {
        set: (patch: RecordedRowMap) => {
          op.set = patch;
          return {
            where: (where: SQL) => {
              op.where = where;
              return Promise.resolve(updateResults.shift() ?? { count: 0 });
            },
          };
        },
      };
    },
  };

  const selects = () => ops.filter((op): op is SelectOp => op.method === 'select');
  const inserts = () => ops.filter((op): op is InsertOp => op.method === 'insert');

  return {
    db: asDatabaseHandle(raw),
    ops: () => ops,
    selects,
    inserts,
    updates: () => ops.filter((op): op is UpdateOp => op.method === 'update'),
    mirrorUpserts: () => inserts().filter((op) => op.table === users),
    profileInserts: () => inserts().filter((op) => op.table === userProfiles),
    nextRows: (rows: SelectRow[] = []) => selectResults.push(rows),
    nextUpdateCount: (count: number) => updateResults.push({ count }),
    failNextUpdate: (error: Error) => {
      updateResults.push(Promise.reject(error));
    },
  };
}

const dialect = new PgDialect();

function renderSql(fragment: RecordedValue): string {
  if (!(fragment instanceof SQL)) throw new Error('Expected a SQL fragment');
  return dialect.sqlToQuery(fragment).sql;
}

interface RenderedCondition {
  sql: string;
  params: unknown[];
}

function renderWhere(where: SQL | undefined): RenderedCondition {
  if (where === undefined) throw new Error('Expected a where condition');
  const { sql, params } = dialect.sqlToQuery(where);
  return { sql, params };
}

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
    verification: { status: VerificationJSON['status'] } | null;
  }>;
}

const CLERK_USER_ID = 'user_2abc123';
const MIGRATED_APP_ID = 'b7c9d1e2-3f40-4a51-8b62-old-supabase';
const EMAIL_PRIMARY_ID = 'idn_email_primary';
const EMAIL_SECONDARY_ID = 'idn_email_secondary';

const CREATED_AT_MS = 1_700_000_000_000;
const LAST_SIGN_IN_MS = 1_700_012_345_678;
const CREATED_AT_ISO = new Date(CREATED_AT_MS).toISOString();
const LAST_SIGN_IN_ISO = new Date(LAST_SIGN_IN_MS).toISOString();

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

type EmailStatus = 'verified' | 'unverified';

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

function backendUser(json: UserJSON): User {
  // eslint-disable-next-line anti-slop/no-chained-type-assertions
  return backendUserFrom(json) as unknown as User;
}

let double: DbDouble;

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.clearAllMocks();
  clearUserVerificationCache();
  double = createDbDouble();
});

describe('syncUserMirrorFromClerkUser', () => {
  it('selects the address matching primary_email_address_id and lowercases it', async () => {
    const user = userJson({
      email_addresses: [
        emailAddress(EMAIL_PRIMARY_ID, 'First@Example.com', 'verified'),
        emailAddress(EMAIL_SECONDARY_ID, 'PRIMARY@Example.ORG', 'unverified'),
      ],
      primary_email_address_id: EMAIL_SECONDARY_ID,
    });

    await expect(syncUserMirrorFromClerkUser(double.db, user)).resolves.toBe(true);

    const [upsert] = double.mirrorUpserts();
    expect(upsert.values.id).toBe(CLERK_USER_ID);
    expect(upsert.values.email).toBe('primary@example.org');
  });

  it('falls back to the first address when no primary id matches', async () => {
    const user = userJson({
      email_addresses: [
        emailAddress('idn_a', 'Second.One@Example.net', 'unverified'),
        emailAddress('idn_b', 'ignored@Example.net', 'verified'),
      ],
      primary_email_address_id: null,
    });

    await expect(syncUserMirrorFromClerkUser(double.db, user)).resolves.toBe(true);

    expect(double.mirrorUpserts()[0].values.email).toBe('second.one@example.net');
  });

  it('stamps a fresh confirmation timestamp for a verified address', async () => {
    const before = Date.now();
    await syncUserMirrorFromClerkUser(double.db, userJson());

    const confirmedAt = String(double.mirrorUpserts()[0].values.email_confirmed_at);
    expect(confirmedAt).toMatch(ISO_LIKE);
    const parsed = Date.parse(confirmedAt);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(Date.now());
  });

  it('leaves email_confirmed_at null for an unverified or unverified-payload address', async () => {
    await syncUserMirrorFromClerkUser(
      double.db,
      userJson({
        email_addresses: [emailAddress(EMAIL_PRIMARY_ID, 'pending@Example.com', 'unverified')],
      })
    );
    expect(double.mirrorUpserts()[0].values.email_confirmed_at).toBeNull();

    await syncUserMirrorFromClerkUser(
      double.db,
      userJson({
        email_addresses: [emailAddress(EMAIL_PRIMARY_ID, 'no-ver@Example.com', null)],
      })
    );
    expect(double.mirrorUpserts()[1].values.email_confirmed_at).toBeNull();
  });

  it('uses external_id as the stable app id while preserving the Clerk id', async () => {
    const migrated = userJson({ external_id: MIGRATED_APP_ID });

    await syncUserMirrorFromClerkUser(double.db, migrated);

    const upsert = double.mirrorUpserts()[0];
    expect(upsert.values.id).toBe(MIGRATED_APP_ID);
    expect(upsert.values.clerk_user_id).toBe(CLERK_USER_ID);

    await syncUserMirrorFromClerkUser(double.db, userJson({ external_id: null }));

    const fallback = double.mirrorUpserts()[1];
    expect(fallback.values.id).toBe(CLERK_USER_ID);
    expect(fallback.values.clerk_user_id).toBe(CLERK_USER_ID);
  });

  it('maps created_at / last_sign_in_at onto ISO values, tolerating null sign-in', async () => {
    await syncUserMirrorFromClerkUser(double.db, userJson());

    const upsert = double.mirrorUpserts()[0];
    expect(upsert.values.created_at).toBe(CREATED_AT_ISO);
    expect(upsert.values.last_sign_in_at).toBe(LAST_SIGN_IN_ISO);

    await syncUserMirrorFromClerkUser(double.db, userJson({ last_sign_in_at: null }));

    const neverSignedIn = double.mirrorUpserts()[1];
    expect(neverSignedIn.values.created_at).toBe(CREATED_AT_ISO);
    expect(neverSignedIn.values.last_sign_in_at).toBeNull();
  });

  it('writes consent timestamps on profile insert only from public_metadata booleans', async () => {
    await syncUserMirrorFromClerkUser(
      double.db,
      userJson({
        public_metadata: { age_verified: true, agreed_to_terms: true },
      })
    );

    const [insert] = double.profileInserts();
    expect(insert.values.user_id).toBe(CLERK_USER_ID);
    const ageAt = String(insert.values.age_verified_at);
    const termsAt = String(insert.values.agreed_to_terms_at);
    expect(ageAt).toMatch(ISO_LIKE);
    expect(termsAt).toMatch(ISO_LIKE);
    expect(ageAt).toBe(termsAt);
    expect(insert.conflict?.target).toBe(userProfiles.user_id);

    await syncUserMirrorFromClerkUser(
      double.db,
      userJson({
        public_metadata: { age_verified: true, agreed_to_terms: false },
      })
    );
    const partial = double.profileInserts()[1].values;
    expect(String(partial.age_verified_at)).toMatch(ISO_LIKE);
    expect(partial.agreed_to_terms_at).toBeNull();

    await syncUserMirrorFromClerkUser(double.db, userJson({ public_metadata: {} }));
    const none = double.profileInserts()[2].values;
    expect(none.age_verified_at).toBeNull();
    expect(none.agreed_to_terms_at).toBeNull();
  });

  it('returns false without touching the DB when the payload has no email', async () => {
    const result = await syncUserMirrorFromClerkUser(
      double.db,
      userJson({
        email_addresses: [],
        primary_email_address_id: null,
      })
    );

    expect(result).toBe(false);
    expect(double.ops()).toHaveLength(0);
  });

  it('replayed created payloads produce identical builder calls and stable id/email', async () => {
    const payload = userJson({
      external_id: MIGRATED_APP_ID,
      email_addresses: [emailAddress(EMAIL_PRIMARY_ID, 'Migrated.User@Example.COM', 'verified')],
      public_metadata: { age_verified: true, agreed_to_terms: true },
    });

    await syncUserMirrorFromClerkUser(double.db, payload);
    await syncUserMirrorFromClerkUser(double.db, payload);

    expect(double.inserts()).toHaveLength(4);

    const [firstMirror, secondMirror] = double.mirrorUpserts();
    expect(secondMirror.values.id).toBe(firstMirror.values.id);
    expect(secondMirror.values.clerk_user_id).toBe(firstMirror.values.clerk_user_id);
    expect(secondMirror.values.email).toBe(firstMirror.values.email);
    expect(secondMirror.values.created_at).toBe(firstMirror.values.created_at);
    expect(secondMirror.values.last_sign_in_at).toBe(firstMirror.values.last_sign_in_at);

    const [firstProfile, secondProfile] = double.profileInserts();
    expect(secondProfile.values.user_id).toBe(firstProfile.values.user_id);

    expect(firstMirror.values.id).toBe(MIGRATED_APP_ID);
    expect(firstMirror.values.email).toBe('migrated.user@example.com');

    for (const mirror of [firstMirror, secondMirror]) {
      expect(String(mirror.values.email_confirmed_at)).toMatch(ISO_LIKE);
    }
    for (const profile of [firstProfile, secondProfile]) {
      const ageAt = String(profile.values.age_verified_at);
      const termsAt = String(profile.values.agreed_to_terms_at);
      expect(ageAt).toMatch(ISO_LIKE);
      expect(ageAt).toBe(termsAt);
    }

    expect(firstMirror.conflict?.target).toBe(users.id);
    const conflictSet = firstMirror.conflict?.set ?? {};
    expect(renderSql(conflictSet.clerk_user_id)).toBe('excluded.clerk_user_id');
    expect(renderSql(conflictSet.email)).toBe('excluded.email');
    const confirmedAtRule = renderSql(conflictSet.email_confirmed_at);
    expect(confirmedAtRule).toContain(
      'when "users"."email" <> excluded.email then excluded.email_confirmed_at'
    );
    expect(confirmedAtRule).toContain(
      'coalesce("users"."email_confirmed_at", excluded.email_confirmed_at)'
    );
    expect(renderSql(conflictSet.last_sign_in_at)).toBe(
      'coalesce(excluded.last_sign_in_at, "users"."last_sign_in_at")'
    );

    expect(firstProfile.conflict?.target).toBe(userProfiles.user_id);
  });
});

describe('repairUserMirror', () => {
  const APP_USER_ID = MIGRATED_APP_ID;

  it('reports existing full consent without using the passed user or writing', async () => {
    double.nextRows([
      {
        age_verified_at: '2026-01-01T00:00:00.000Z',
        agreed_to_terms_at: '2026-01-01T00:00:01.000Z',
      },
    ]);

    const result = await repairUserMirror(double.db, APP_USER_ID, backendUser(userJson()));

    expect(result).toEqual({ hasConsent: true });
    const [probe] = double.selects();
    expect(probe.table).toBe(userProfiles);
    expect(Object.keys(probe.projection).sort()).toEqual(
      ['age_verified_at', 'agreed_to_terms_at'].sort()
    );
    expect(renderWhere(probe.where)).toEqual({
      sql: '"user_profiles"."user_id" = $1',
      params: [APP_USER_ID],
    });
    expect(double.inserts()).toHaveLength(0);
  });

  it('never reads the passed user when the profile row already exists', async () => {
    double.nextRows([
      {
        age_verified_at: '2026-01-01T00:00:00.000Z',
        agreed_to_terms_at: '2026-01-01T00:00:01.000Z',
      },
    ]);
    const untouched = new Proxy(
      {},
      {
        get: () => {
          throw new Error('repair must not read the passed user on a cache hit');
        },
      }
    );

    // eslint-disable-next-line anti-slop/no-chained-type-assertions
    const result = await repairUserMirror(double.db, APP_USER_ID, untouched as unknown as User);

    expect(result).toEqual({ hasConsent: true });
    expect(double.ops()).toHaveLength(1);
    expect(double.inserts()).toHaveLength(0);
  });

  it('preserves the existing confirmation timestamp when the email is unchanged', async () => {
    double.nextRows([]);
    double.nextRows([{ age_verified_at: null, agreed_to_terms_at: null }]);

    await repairUserMirror(
      double.db,
      APP_USER_ID,
      backendUser(userJson({ external_id: MIGRATED_APP_ID }))
    );

    const [mirror] = double.mirrorUpserts();
    expect(mirror.conflict?.target).toBe(users.id);
    const conflictSet = mirror.conflict?.set ?? {};
    const confirmedAtRule = renderSql(conflictSet.email_confirmed_at);
    expect(confirmedAtRule).toContain(
      'when "users"."email" <> excluded.email then excluded.email_confirmed_at'
    );
    expect(confirmedAtRule).toContain(
      'coalesce("users"."email_confirmed_at", excluded.email_confirmed_at)'
    );
  });

  it('requires BOTH consent timestamps before reporting hasConsent', async () => {
    double.nextRows([{ age_verified_at: '2026-01-01T00:00:00.000Z', agreed_to_terms_at: null }]);

    const result = await repairUserMirror(double.db, APP_USER_ID, backendUser(userJson()));

    expect(result).toEqual({ hasConsent: false });
    expect(double.inserts()).toHaveLength(0);
  });

  it('upserts the passed Clerk user when the profile row is missing (verified user)', async () => {
    const clerkUser = userJson({
      external_id: MIGRATED_APP_ID,
      public_metadata: { age_verified: true, agreed_to_terms: true },
    });
    double.nextRows([]);
    double.nextRows([
      {
        age_verified_at: '2026-01-01T00:00:00.000Z',
        agreed_to_terms_at: '2026-01-01T00:00:01.000Z',
      },
    ]);

    const result = await repairUserMirror(double.db, APP_USER_ID, backendUser(clerkUser));

    expect(result).toEqual({ hasConsent: true });

    const [mirror] = double.mirrorUpserts();
    expect(mirror.values.id).toBe(APP_USER_ID);
    expect(mirror.values.clerk_user_id).toBe(CLERK_USER_ID);
    expect(mirror.values.email).toBe('mixedcase@example.com');
    expect(String(mirror.values.email_confirmed_at)).toMatch(ISO_LIKE);
    expect(mirror.values.created_at).toBe(CREATED_AT_ISO);
    expect(mirror.values.last_sign_in_at).toBe(LAST_SIGN_IN_ISO);
    const [profile] = double.profileInserts();
    expect(String(profile.values.age_verified_at)).toMatch(ISO_LIKE);
    expect(String(profile.values.agreed_to_terms_at)).toMatch(ISO_LIKE);
  });

  it('upserts unverified users without metadata and reports inserted consent state', async () => {
    const clerkUser = userJson({
      email_addresses: [emailAddress(EMAIL_PRIMARY_ID, 'Unverified@Example.COM', 'unverified')],
      last_sign_in_at: null,
      public_metadata: {},
    });
    double.nextRows([]);
    double.nextRows([{ age_verified_at: null, agreed_to_terms_at: null }]);

    const result = await repairUserMirror(double.db, CLERK_USER_ID, backendUser(clerkUser));

    expect(result).toEqual({ hasConsent: false });
    const mirror = double.mirrorUpserts()[0];
    expect(mirror.values.id).toBe(CLERK_USER_ID);
    expect(mirror.values.clerk_user_id).toBe(CLERK_USER_ID);
    expect(mirror.values.email).toBe('unverified@example.com');
    expect(mirror.values.email_confirmed_at).toBeNull();
    expect(mirror.values.created_at).toBe(CREATED_AT_ISO);
    expect(mirror.values.last_sign_in_at).toBeNull();
    const profile = double.profileInserts()[0].values;
    expect(profile.age_verified_at).toBeNull();
    expect(profile.agreed_to_terms_at).toBeNull();
  });

  it('returns null without writing when the Clerk user has no email', async () => {
    const clerkUser = backendUser(
      userJson({ email_addresses: [], primary_email_address_id: null })
    );

    const result = await repairUserMirror(double.db, CLERK_USER_ID, clerkUser);

    expect(result).toBeNull();
    expect(double.inserts()).toHaveLength(0);
  });

  it('reports the consent persisted after an insert/conflict race, not Clerk metadata', async () => {
    const clerkUser = userJson({
      external_id: MIGRATED_APP_ID,
      public_metadata: { age_verified: true, agreed_to_terms: true },
    });
    double.nextRows([]);
    double.nextRows([
      {
        age_verified_at: '2026-01-01T00:00:00.000Z',
        agreed_to_terms_at: null,
      },
    ]);

    const result = await repairUserMirror(double.db, APP_USER_ID, backendUser(clerkUser));

    expect(result).toEqual({ hasConsent: false });

    expect(double.selects()).toHaveLength(2);
    const [reRead] = double.selects().slice(-1);
    expect(renderWhere(reRead.where).params).toEqual([APP_USER_ID]);
    const reReadIndex = double.ops().indexOf(reRead);
    for (const insert of double.inserts()) {
      expect(double.ops().indexOf(insert)).toBeLessThan(reReadIndex);
    }
  });

  it('reports retained consent even when Clerk metadata claims none after the race', async () => {
    const clerkUser = userJson({
      external_id: MIGRATED_APP_ID,
      public_metadata: { age_verified: false, agreed_to_terms: false },
    });
    double.nextRows([]);
    double.nextRows([
      {
        age_verified_at: '2026-01-01T00:00:00.000Z',
        agreed_to_terms_at: '2026-01-01T00:00:01.000Z',
      },
    ]);

    await expect(repairUserMirror(double.db, APP_USER_ID, backendUser(clerkUser))).resolves.toEqual(
      {
        hasConsent: true,
      }
    );
  });

  it('throws when the profile row is inexplicably absent after the upsert', async () => {
    const clerkUser = userJson({
      external_id: MIGRATED_APP_ID,
      public_metadata: { age_verified: true, agreed_to_terms: true },
    });
    await expect(
      repairUserMirror(double.db, APP_USER_ID, backendUser(clerkUser))
    ).rejects.toThrow();

    expect(double.inserts()).toHaveLength(2);
    expect(double.selects()).toHaveLength(2);
  });
});

describe('webhook/repair verified-state consistency (#358)', () => {
  it.each([
    ['verified', 'verified' as const],
    ['unverified', 'unverified' as const],
  ])('%s identity yields the same mirror row through sync and repair', async (_label, status) => {
    const shared = {
      external_id: MIGRATED_APP_ID,
      email_addresses: [emailAddress(EMAIL_PRIMARY_ID, 'Shared@Example.COM', status)],
    };

    await syncUserMirrorFromClerkUser(double.db, userJson(shared));
    const synced = double.mirrorUpserts()[0].values;

    double.nextRows([]);
    double.nextRows([
      {
        age_verified_at: '2026-01-01T00:00:00.000Z',
        agreed_to_terms_at: '2026-01-01T00:00:01.000Z',
      },
    ]);
    await repairUserMirror(double.db, MIGRATED_APP_ID, backendUser(userJson(shared)));
    const repaired = double.mirrorUpserts()[1].values;

    expect(repaired.id).toBe(synced.id);
    expect(repaired.clerk_user_id).toBe(synced.clerk_user_id);
    expect(repaired.email).toBe(synced.email);
    expect(repaired.created_at).toBe(synced.created_at);
    expect(repaired.last_sign_in_at).toBe(synced.last_sign_in_at);

    if (status === 'verified') {
      expect(String(repaired.email_confirmed_at)).toMatch(ISO_LIKE);
      expect(String(synced.email_confirmed_at)).toMatch(ISO_LIKE);
    } else {
      expect(repaired.email_confirmed_at).toBeNull();
      expect(synced.email_confirmed_at).toBeNull();
    }
  });
});

describe('readUserVerification', () => {
  const ROW = { email: 'gate@example.com', email_confirmed_at: '2026-02-03T04:05:06.000Z' };

  it('live reads project the mirror gate columns keyed by users.id, or null when absent', async () => {
    double.nextRows([ROW]);

    await expect(readUserVerification(double.db, 'u1', { cache: false })).resolves.toEqual(ROW);
    const [select] = double.selects();
    expect(select.table).toBe(users);
    expect(select.projection).toEqual({
      email: users.email,
      email_confirmed_at: users.email_confirmed_at,
    });
    expect(renderWhere(select.where)).toEqual({ sql: '"users"."id" = $1', params: ['u1'] });

    double.nextRows([]);
    await expect(readUserVerification(double.db, 'u1', { cache: false })).resolves.toBeNull();
  });

  it('serves subsequent cached reads from memory without re-querying', async () => {
    double.nextRows([ROW]);
    double.nextRows([ROW]);

    const first = await readUserVerification(double.db, 'u1', { cache: true });
    const second = await readUserVerification(double.db, 'u1', { cache: true });

    expect(first).toEqual(ROW);
    expect(second).toEqual(ROW);
    expect(double.selects()).toHaveLength(1);

    await expect(readUserVerification(double.db, 'u2', { cache: true })).resolves.toEqual(ROW);
    expect(double.selects()).toHaveLength(2);
  });

  it('caches null as "unverified" until explicitly cleared', async () => {
    await expect(readUserVerification(double.db, 'u1', { cache: true })).resolves.toBeNull();

    double.nextRows([ROW]);
    await expect(readUserVerification(double.db, 'u1', { cache: true })).resolves.toBeNull();
    expect(double.selects()).toHaveLength(1);

    await expect(readUserVerification(double.db, 'u1', { cache: false })).resolves.toEqual(ROW);

    clearUserVerificationCache();
    double.nextRows([ROW]);
    await expect(readUserVerification(double.db, 'u1', { cache: true })).resolves.toEqual(ROW);
  });
});

describe('softDeleteUserById', () => {
  it('disables either the app-id or Clerk-id profile with coalesced suppression stamps', async () => {
    double.nextUpdateCount(2);

    await expect(softDeleteUserById(double.db, CLERK_USER_ID)).resolves.toBe(2);

    expect(double.updates()).toHaveLength(1);
    const [update] = double.updates();
    expect(update.table).toBe(userProfiles);
    expect(update.set.is_disabled).toBe(true);
    expect(update.set.notifications_enabled).toBe(false);
    expect(renderSql(update.set.disabled_at)).toBe(
      'coalesce("user_profiles"."disabled_at", now())'
    );
    expect(renderSql(update.set.unsubscribed_at)).toBe(
      'coalesce("user_profiles"."unsubscribed_at", now())'
    );

    const where = renderWhere(update.where);
    expect(where.params[0]).toBe(CLERK_USER_ID);
    expect(where.sql).toContain('"user_profiles"."user_id" = $1');
    expect(where.sql).toContain('"user_profiles"."user_id" in $2');

    const mirrorSelects = double.selects().filter((op) => op.table === users);
    expect(mirrorSelects).toHaveLength(1);
    const [mirrorSelect] = mirrorSelects;
    expect(mirrorSelect.projection).toEqual({ id: users.id });
    expect(renderWhere(mirrorSelect.where)).toEqual({
      sql: '"users"."clerk_user_id" = $1',
      params: [CLERK_USER_ID],
    });
  });

  it('propagates DB failures after logging', async () => {
    double.failNextUpdate(new Error('connection reset'));

    await expect(softDeleteUserById(double.db, CLERK_USER_ID)).rejects.toThrow('connection reset');
  });
});
