import { randomUUID } from 'node:crypto';
import { and, count, eq, inArray, like, sql } from 'drizzle-orm';
import type { EmailAddressJSON, UserJSON, VerificationJSON } from '@clerk/backend';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

import { getDb } from '@/lib/db';
import {
  PG_RAISE_EXCEPTION,
  PG_UNIQUE_VIOLATION,
  PG_UNDEFINED_FUNCTION,
  driverErrorMessage,
  getPgError,
  isRaisedException,
  isUndefinedFunction,
  isUniqueViolation,
} from '@/lib/db/pg-errors';
import {
  capConsecutiveNotFound,
  deleteNotificationRecords,
  deletePastTermWatches,
  deleteSectionAndWatches,
  getClassWatchers,
  getMostWatchedClass,
  getNotificationWatchers,
  getSectionsToCheck,
  incrementConsecutiveNotFound,
  readAutoCleanupBreakerCounts,
  readSectionCheckState,
  readSectionRemovalClassInfo,
  resetNotificationsForSection,
  tryRecordNotificationsBatch,
  upsertClassState,
} from '@/lib/db/queries';
import {
  getAdminCount,
  getClassesPage,
  getDistinctSubjects,
  getRecentActivity,
  getTotalClassesWatched,
  getTotalEmailsSent,
  getTotalUsers,
  getUserWatches,
  getUsersPage,
} from '@/lib/db/admin-queries';
import {
  readUserVerification,
  softDeleteUserById,
  syncUserMirrorFromClerkUser,
} from '@/lib/db/users';
import { classStates, classWatches, notificationsSent, userProfiles, users } from '@/lib/db/schema';
import { readOnboardingState, skipOnboarding } from '@/lib/onboarding';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL must point at a disposable PostgreSQL carrying ' +
      'db/migrations/20260822000000_planetscale_schema.sql (see vitest.db.config.ts).'
  );
}

const hyperdrive = { connectionString: DATABASE_URL } as Hyperdrive;

const db = getDb(hyperdrive);

const RUN = `dlv-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

const TERM = `${RUN}-t1`;
const TERM_OTHER = `${RUN}-t2`;
const TERM_EMPTY = `${RUN}-t3`;
const SUBJECT = `ZZ${RUN}`;

const REF_A = { class_nbr: `${RUN}0`, term: TERM };
const REF_B = { class_nbr: `${RUN}2`, term: TERM };
const REF_C = { class_nbr: `${RUN}4`, term: TERM };
const REF_FULL = { class_nbr: `${RUN}6`, term: TERM };
const REF_ODD = { class_nbr: `${RUN}3`, term: TERM };
const REF_B_OTHER_TERM = { class_nbr: `${RUN}2`, term: TERM_OTHER };
const REF_INC = { class_nbr: `${RUN}5`, term: TERM };
const REF_LIMIT_1 = { class_nbr: `${RUN}8`, term: TERM };
const REF_LIMIT_2 = { class_nbr: `${RUN}9`, term: TERM };

const uid = (tag: string) => `${RUN}_u_${tag}`;
const mail = (tag: string) => `${RUN}.${tag}@emails.example.test`;

const U_MAIN = uid('main');
const U_BOUNCED = uid('bounced');
const U_DISABLED = uid('disabled');
const U_UNSUB = uid('unsub');
const U_SPAM = uid('spam');
const U_XT = uid('xterm');
const U_ODD = uid('odd');
const U_LIMIT = uid('limit');
const U_TX = uid('tx');
const U_ONBOARD = uid('onboard');
const U_WEBHOOK = uid('webhook');
const U_ADMIN = uid('admin');
const U_CRUD = uid('crud');

let W_A_MAIN: string;
let W_A_BOUNCED: string;
let W_A_DISABLED: string;
let W_B_MAIN: string;
let W_B_SPAM: string;
let W_XT: string;
let W_C_1: string;
let W_C_2: string;
let W_ODD: string;

beforeAll(async () => {
  await db
    .insert(users)
    .values(
      [
        U_MAIN,
        U_BOUNCED,
        U_DISABLED,
        U_UNSUB,
        U_SPAM,
        U_XT,
        U_ODD,
        U_LIMIT,
        U_TX,
        U_ONBOARD,
        U_ADMIN,
        U_CRUD,
      ].map((id) => ({ id, clerk_user_id: `clerk_${id}`, email: mail(id.slice(RUN.length + 3)) }))
    );

  await db.insert(userProfiles).values(
    [U_MAIN, U_BOUNCED, U_DISABLED, U_UNSUB, U_SPAM, U_XT, U_ODD, U_ADMIN].map((userId) => ({
      user_id: userId,
    }))
  );
  await db
    .update(userProfiles)
    .set({ email_bounced: true })
    .where(eq(userProfiles.user_id, U_BOUNCED));
  await db
    .update(userProfiles)
    .set({ is_disabled: true, disabled_at: new Date().toISOString() })
    .where(eq(userProfiles.user_id, U_DISABLED));
  await db
    .update(userProfiles)
    .set({ unsubscribed_at: new Date().toISOString() })
    .where(eq(userProfiles.user_id, U_UNSUB));
  await db
    .update(userProfiles)
    .set({ spam_complained: true })
    .where(eq(userProfiles.user_id, U_SPAM));
  await db.update(userProfiles).set({ is_admin: true }).where(eq(userProfiles.user_id, U_ADMIN));

  const stateDetails = (seatsAvailable: number) => ({
    subject: SUBJECT,
    catalog_nbr: '310',
    title: `Live Probe ${RUN}`,
    instructor_name: 'Dr. Fixture',
    seats_available: seatsAvailable,
    seats_capacity: 30,
    non_reserved_seats: seatsAvailable > 0 ? seatsAvailable : null,
    location: 'TEMPE',
    meeting_times: 'MW 10:00-11:15',
  });
  await upsertClassState(db, REF_A, stateDetails(7));
  await upsertClassState(db, REF_B, stateDetails(5));
  await upsertClassState(db, REF_C, stateDetails(3));
  await upsertClassState(db, REF_FULL, stateDetails(0));

  const watch = async (userId: string, ref: { class_nbr: string; term: string }) => {
    const [row] = await db
      .insert(classWatches)
      .values({
        user_id: userId,
        class_nbr: ref.class_nbr,
        term: ref.term,
        subject: SUBJECT,
        catalog_nbr: '310',
      })
      .returning({ id: classWatches.id });
    return row.id;
  };
  W_A_MAIN = await watch(U_MAIN, REF_A);
  W_A_BOUNCED = await watch(U_BOUNCED, REF_A);
  W_A_DISABLED = await watch(U_DISABLED, REF_A);
  W_B_MAIN = await watch(U_MAIN, REF_B);
  W_B_SPAM = await watch(U_SPAM, REF_B);
  W_XT = await watch(U_XT, REF_B_OTHER_TERM);
  W_C_1 = await watch(U_MAIN, REF_C);
  W_C_2 = await watch(U_XT, REF_C);
  W_ODD = await watch(U_ODD, REF_ODD);

  await db.insert(notificationsSent).values({
    class_watch_id: W_ODD,
    notification_type: 'seat_available',
  });
});

afterAll(async () => {
  try {
    await db.delete(users).where(like(users.id, `%${RUN}%`));
    await db.delete(classStates).where(like(classStates.class_nbr, `${RUN}%`));
  } finally {
    await db.$client.end();
  }
});

async function capture<T>(run: () => Promise<T>): Promise<Error | null> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return null;
}

type TimestampCell = string | null | undefined;

function temporal(value: TimestampCell): boolean {
  if (value === null || value === undefined) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function isIsoZ(value: TimestampCell): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CountRow {
  n: unknown;
}

async function scalarCount(query: PromiseLike<CountRow[]>): Promise<number> {
  const rows = await query;
  return Number(rows[0]?.n ?? 0);
}

type CreatedWatchRow = {
  id: string;
  user_id: string;
  class_nbr: string;
  term: string;
  subject: string;
  catalog_nbr: string;
  created_at: string;
};

const CREATED_MS = 1_750_000_000_000;
const LAST_SIGN_IN_MS = 1_750_000_001_000;

function emailAddress(
  id: string,
  address: string,
  status: 'verified' | 'unverified' | null
): EmailAddressJSON {
  const verification: VerificationJSON | null =
    status === null
      ? null
      : {
          object: 'email_address',
          id: `${id}_ver`,
          status,
          strategy: 'email_code',
          attempts: null,
          expire_at: null,
        };
  return {
    object: 'email_address',
    id,
    email_address: address,
    verification,
    linked_to: [],
  };
}

function userJson(overrides: Partial<UserJSON>): UserJSON {
  return {
    object: 'user',
    id: `clerk_${U_WEBHOOK}`,
    username: null,
    first_name: null,
    last_name: null,
    image_url: 'https://img.clerk.com/default.png',
    has_image: false,
    primary_email_address_id: 'email_primary',
    primary_phone_number_id: null,
    primary_web3_wallet_id: null,
    password_enabled: true,
    two_factor_enabled: false,
    totp_enabled: false,
    backup_code_enabled: false,
    email_addresses: [emailAddress('email_primary', mail('webhook'), 'verified')],
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
    created_at: CREATED_MS,
    updated_at: CREATED_MS,
    last_active_at: null,
    create_organization_enabled: false,
    create_organizations_limit: null,
    delete_self_enabled: true,
    legal_accepted_at: null,
    locale: null,
    ...overrides,
  };
}

describe('SQLSTATE helpers against real driver errors', () => {
  it('declares the exact PostgreSQL SQLSTATE constants', () => {
    expect(PG_UNIQUE_VIOLATION).toBe('23505');
    expect(PG_RAISE_EXCEPTION).toBe('P0001');
    expect(PG_UNDEFINED_FUNCTION).toBe('42883');
  });

  it('narrows a real unique violation (23505) through the cause chain', async () => {
    const error = await capture(() =>
      db.insert(classWatches).values({
        user_id: U_MAIN,
        class_nbr: REF_A.class_nbr,
        term: TERM,
        subject: SUBJECT,
        catalog_nbr: '310',
      })
    );
    expect(isUniqueViolation(error)).toBe(true);
    expect(getPgError(error)?.code).toBe(PG_UNIQUE_VIOLATION);
  });

  it('keeps the duplicate-key message fallback for code-dropping intermediaries', () => {
    expect(isUniqueViolation(new Error('duplicate key value violates unique constraint "x"'))).toBe(
      true
    );
    expect(isUniqueViolation(new Error('some other failure'))).toBe(false);
    expect(getPgError(null)).toBeNull();
    expect(getPgError('not-an-error')).toBeNull();
  });

  it('maps a PL/pgSQL RAISE EXCEPTION to P0001', async () => {
    const error = await capture(() =>
      db.execute(
        sql`SELECT public.increment_consecutive_not_found(${REF_INC.class_nbr}::text, ${REF_INC.term}::text)`
      )
    );
    expect(error).not.toBeNull();
    expect(driverErrorMessage(error)).toMatch(/Section not found/);
    expect(isRaisedException(error)).toBe(true);
    expect(getPgError(error)?.code).toBe(PG_RAISE_EXCEPTION);
  });

  it('maps a missing RPC to undefined function (42883)', async () => {
    const fnName = `definitely_missing_rpc_${RUN.replace(/-/g, '_')}`;
    const error = await capture(() => db.execute(sql`SELECT public.${sql.identifier(fnName)}()`));
    expect(error).not.toBeNull();
    expect(isUndefinedFunction(error)).toBe(true);
    expect(getPgError(error)?.code).toBe(PG_UNDEFINED_FUNCTION);
  });

  it('survives unrelated thrown values', () => {
    expect(isRaisedException(new Error('plain'))).toBe(false);
    expect(isUndefinedFunction(undefined)).toBe(false);
    expect(isUniqueViolation(42)).toBe(false);
  });
});

describe('wire formats under prepare:false / fetch_types:false', () => {
  it('returns int8 as a precision-safe string', async () => {
    const rows = await db.execute<{ c: string }>(
      sql`SELECT COUNT(*)::bigint AS c FROM class_watches`
    );
    expect(typeof rows[0]?.c).toBe('string');
    expect(String(rows[0]?.c)).toMatch(/^\d+$/);
  });

  it('delivers timestamptz as parseable PG text (boundaries normalize to ISO)', async () => {
    const rows = await db.execute<{ t: string }>(sql`SELECT now()::timestamptz AS t`);
    expect(typeof rows[0]?.t).toBe('string');
    expect(temporal(rows[0]?.t)).toBe(true);
  });

  it('round-trips array-bound RPC parameters through the recipient read', async () => {
    expect(await getNotificationWatchers(db, REF_FULL)).toEqual([]);
  });
});

describe('Drizzle builder CRUD row shapes', () => {
  it('inserts, reads, updates, and deletes rows with schema-exact shapes', async () => {
    const [inserted] = await db
      .insert(users)
      .values({
        id: `${U_CRUD}_b`,
        email: mail('crud-b'),
      })
      .returning();
    expect(Object.keys(inserted).sort()).toEqual(
      ['clerk_user_id', 'created_at', 'email', 'email_confirmed_at', 'id', 'last_sign_in_at'].sort()
    );
    expect(inserted.clerk_user_id).toBeNull();
    expect(inserted.last_sign_in_at).toBeNull();
    expect(temporal(inserted.created_at)).toBe(true);

    const stamp = new Date('2026-08-25T12:34:56.789Z').toISOString();
    await db.update(users).set({ last_sign_in_at: stamp }).where(eq(users.id, inserted.id));
    const [reread] = await db.select().from(users).where(eq(users.id, inserted.id));
    expect(reread.last_sign_in_at).not.toBeNull();
    expect(new Date(String(reread.last_sign_in_at)).getTime()).toBe(new Date(stamp).getTime());

    await db.delete(users).where(eq(users.id, inserted.id));
    const remaining = await scalarCount(
      db.select({ n: count() }).from(users).where(eq(users.id, inserted.id))
    );
    expect(remaining).toBe(0);
  });

  it('projects profile defaults as real booleans and null timestamps', async () => {
    const [profile] = await db.insert(userProfiles).values({ user_id: U_CRUD }).returning();
    expect(Object.keys(profile).sort()).toEqual(
      [
        'age_verified_at',
        'agreed_to_terms_at',
        'created_at',
        'disabled_at',
        'email_bounced',
        'email_bounced_at',
        'id',
        'is_admin',
        'is_disabled',
        'notifications_enabled',
        'onboarding_completed_at',
        'onboarding_skipped_at',
        'spam_complained',
        'spam_complained_at',
        'unsubscribed_at',
        'updated_at',
        'user_id',
      ].sort()
    );
    expect(profile.is_admin).toBe(false);
    expect(profile.is_disabled).toBe(false);
    expect(profile.notifications_enabled).toBe(true);
    expect(profile.email_bounced).toBe(false);
    expect(profile.spam_complained).toBe(false);
    expect(profile.onboarding_completed_at).toBeNull();
    expect(profile.onboarding_skipped_at).toBeNull();

    const second = await capture(() => db.insert(userProfiles).values({ user_id: U_CRUD }));
    expect(isUniqueViolation(second)).toBe(true);
  });

  it('enforces the per-user watch uniqueness and returns UUID/timestamp shapes', async () => {
    const [watch] = await db
      .insert(classWatches)
      .values({
        user_id: U_CRUD,
        class_nbr: `${RUN}7`,
        term: TERM,
        subject: SUBJECT,
        catalog_nbr: '310',
      })
      .returning();
    expect(watch.id).toMatch(UUID_RE);
    expect(temporal(watch.created_at)).toBe(true);

    const duplicate = await capture(() =>
      db.insert(classWatches).values({
        user_id: U_CRUD,
        class_nbr: `${RUN}7`,
        term: TERM,
        subject: SUBJECT,
        catalog_nbr: '310',
      })
    );
    expect(isUniqueViolation(duplicate)).toBe(true);

    const deleted = await db
      .delete(classWatches)
      .where(eq(classWatches.id, watch.id))
      .returning({ id: classWatches.id });
    expect(deleted).toHaveLength(1);
  });

  it('reads class_states rows back with exact column shapes after upsert', async () => {
    const [state] = await db
      .select()
      .from(classStates)
      .where(and(eq(classStates.class_nbr, REF_A.class_nbr), eq(classStates.term, TERM)));
    expect(Object.keys(state).sort()).toEqual(
      [
        'class_nbr',
        'consecutive_not_found_count',
        'catalog_nbr',
        'id',
        'instructor_name',
        'last_changed_at',
        'last_checked_at',
        'location',
        'meeting_times',
        'non_reserved_seats',
        'seats_available',
        'seats_capacity',
        'subject',
        'term',
        'title',
      ].sort()
    );
    expect(state.seats_available).toBe(7);
    expect(state.non_reserved_seats).toBe(7);
    expect(state.consecutive_not_found_count).toBe(0);
    expect(state.id).toMatch(UUID_RE);
    expect(temporal(state.last_checked_at)).toBe(true);
    expect(temporal(state.last_changed_at)).toBe(true);
  });
});

describe('upsertClassState / section-check pipeline ops', () => {
  it('updates an existing section without duplicating it', async () => {
    await upsertClassState(db, REF_A, {
      subject: SUBJECT,
      catalog_nbr: '310',
      title: `Live Probe ${RUN} II`,
      instructor_name: 'Dr. Fixture',
      seats_available: 11,
      seats_capacity: 30,
      non_reserved_seats: 9,
      location: 'TEMPE',
      meeting_times: 'MW 10:00-11:15',
    });
    const baseline = await readSectionCheckState(db, REF_A);
    expect(baseline).toEqual({
      class_nbr: REF_A.class_nbr,
      term: TERM,
      seats_available: 11,
      non_reserved_seats: 9,
      instructor_name: 'Dr. Fixture',
      consecutive_not_found_count: 0,
    });
  });

  it('returns null section-check state for unknown sections', async () => {
    expect(await readSectionCheckState(db, REF_INC)).toBeNull();
  });

  it('increments atomically: recovers from Section-not-found, then RPC increments', async () => {
    expect(await incrementConsecutiveNotFound(db, REF_INC)).toBe(1);
    expect(await incrementConsecutiveNotFound(db, REF_INC)).toBe(2);
    const state = await readSectionCheckState(db, REF_INC);
    expect(state?.consecutive_not_found_count).toBe(2);
  });

  it('caps the counter and skips no-op writes', async () => {
    await capConsecutiveNotFound(db, REF_INC, 1);
    expect((await readSectionCheckState(db, REF_INC))?.consecutive_not_found_count).toBe(1);
    await capConsecutiveNotFound(db, REF_INC, 1);
    expect((await readSectionCheckState(db, REF_INC))?.consecutive_not_found_count).toBe(1);
  });

  it('reads removal info and breaker counts', async () => {
    expect(await readSectionRemovalClassInfo(db, REF_INC)).toEqual({
      subject: '',
      catalog_nbr: '',
      title: null,
    });
    const breaker = await readAutoCleanupBreakerCounts(db);
    expect(typeof breaker.total).toBe('number');
    expect(typeof breaker.flagged).toBe('number');
    expect(breaker.total).toBeGreaterThanOrEqual(5);
    expect(breaker.flagged).toBeGreaterThanOrEqual(1);
  });
});

describe('create_class_watch_with_limit RPC', () => {
  it('creates the watch and returns the full class_watches row', async () => {
    const rows = await db.execute<CreatedWatchRow>(
      sql`SELECT * FROM public.create_class_watch_with_limit(
        ${U_LIMIT}::text,
        ${TERM}::text,
        ${SUBJECT}::text,
        '310'::text,
        ${REF_LIMIT_1.class_nbr}::text,
        ${1}::integer
      )`
    );
    const row = rows[0];
    expect(row).toBeDefined();
    for (const key of [
      'id',
      'user_id',
      'class_nbr',
      'term',
      'subject',
      'catalog_nbr',
      'created_at',
    ]) {
      expect(Object.keys(row)).toContain(key);
    }
    expect(row.user_id).toBe(U_LIMIT);
    expect(row.class_nbr).toBe(REF_LIMIT_1.class_nbr);
    expect(row.term).toBe(TERM);
    expect(String(row.id)).toMatch(UUID_RE);
    expect(temporal(row.created_at)).toBe(true);
  });

  it('raises MAX_WATCHES_EXCEEDED (P0001) once the limit is reached', async () => {
    const error = await capture(() =>
      db.execute(
        sql`SELECT * FROM public.create_class_watch_with_limit(
          ${U_LIMIT}::text,
          ${TERM}::text,
          ${SUBJECT}::text,
          '310'::text,
          ${REF_LIMIT_2.class_nbr}::text,
          ${1}::integer
        )`
      )
    );
    expect(error).not.toBeNull();
    expect(driverErrorMessage(error)).toMatch(/MAX_WATCHES_EXCEEDED/);
    expect(isRaisedException(error)).toBe(true);
  });
});

describe('watcher reads and eligibility RPCs', () => {
  it('lists only eligible watchers with normalized ISO timestamps', async () => {
    const watchers = await getClassWatchers(db, REF_A);
    const watcherIds = watchers.map((w) => w.watch_id);
    expect(watcherIds).toEqual([W_A_MAIN]);
    expect(watcherIds).not.toContain(W_A_BOUNCED);
    expect(watcherIds).not.toContain(W_A_DISABLED);
    expect(watchers[0]).toMatchObject({
      user_id: U_MAIN,
      watch_id: W_A_MAIN,
    });
    expect(watchers[0].email).toBe(mail('main'));
    expect(isIsoZ(watchers[0].created_at)).toBe(true);
  });

  it('scopes batch recipient reads to the requested sections AND term', async () => {
    const watchers = await getNotificationWatchers(db, REF_B);
    const watcherIds = watchers.map((w) => w.watch_id);
    expect(watcherIds).toEqual([W_B_MAIN]);
    expect(watcherIds).not.toContain(W_B_SPAM);
    expect(watcherIds).not.toContain(W_XT);
    expect(watchers[0].user_id).toBe(U_MAIN);
  });

  it('enumerates sections to check with stagger parity filtering', async () => {
    const mine = (refs: { class_nbr: string; term: string }[]) =>
      refs
        .filter((r) => r.term === TERM || r.term === TERM_OTHER)
        .map((r) => `${r.term}:${r.class_nbr}`)
        .sort();

    expect(mine(await getSectionsToCheck(db, 'all'))).toEqual(
      [
        `${TERM}:${REF_A.class_nbr}`,
        `${TERM}:${REF_B.class_nbr}`,
        `${TERM}:${REF_C.class_nbr}`,
        `${TERM}:${REF_ODD.class_nbr}`,
        `${TERM}:${REF_LIMIT_1.class_nbr}`,
        `${TERM_OTHER}:${REF_B_OTHER_TERM.class_nbr}`,
      ].sort()
    );
    expect(mine(await getSectionsToCheck(db, 'even'))).toEqual(
      [
        `${TERM}:${REF_A.class_nbr}`,
        `${TERM}:${REF_B.class_nbr}`,
        `${TERM}:${REF_C.class_nbr}`,
        `${TERM}:${REF_LIMIT_1.class_nbr}`,
        `${TERM_OTHER}:${REF_B_OTHER_TERM.class_nbr}`,
      ].sort()
    );
    expect(mine(await getSectionsToCheck(db, 'odd'))).toEqual([`${TERM}:${REF_ODD.class_nbr}`]);
  });

  it('picks the most-watched class by eligible watchers with deterministic tiebreak', async () => {
    expect(await getMostWatchedClass(db, TERM)).toEqual(REF_C);
    expect(await getMostWatchedClass(db, TERM_EMPTY)).toBeNull();
  });
});

describe('notification dedup lifecycle', () => {
  it('claims each watch once, frees expired slots, and rolls back claims', async () => {
    const first = await tryRecordNotificationsBatch(db, [W_C_1, W_C_2], 'seat_available');
    expect([...first].sort()).toEqual([W_C_1, W_C_2].sort());

    const second = await tryRecordNotificationsBatch(db, [W_C_1, W_C_2], 'seat_available');
    expect(second.size).toBe(0);

    await db
      .update(notificationsSent)
      .set({ expires_at: '2020-01-01T00:00:00.000Z' })
      .where(inArray(notificationsSent.class_watch_id, [W_C_1, W_C_2]));
    const swept = await db.execute<{ n: string }>(
      sql`SELECT public.expire_stale_notifications() AS n`
    );
    expect(Number(swept[0]?.n)).toBeGreaterThanOrEqual(2);
    const inactive = await scalarCount(
      db
        .select({ n: count() })
        .from(notificationsSent)
        .where(
          and(
            inArray(notificationsSent.class_watch_id, [W_C_1, W_C_2]),
            eq(notificationsSent.is_active, false)
          )
        )
    );
    expect(inactive).toBe(2);

    const third = await tryRecordNotificationsBatch(db, [W_C_1, W_C_2], 'seat_available');
    expect([...third].sort()).toEqual([W_C_1, W_C_2].sort());
  });

  it('rolls back failed sends by deleting only active claims', async () => {
    const deleted = await deleteNotificationRecords(db, [W_C_1], 'seat_available');
    expect(deleted).toBe(1);
    const activeLeft = await scalarCount(
      db
        .select({ n: count() })
        .from(notificationsSent)
        .where(
          and(
            inArray(notificationsSent.class_watch_id, [W_C_1, W_C_2]),
            eq(notificationsSent.is_active, true)
          )
        )
    );
    expect(activeLeft).toBe(1);
  });

  it('enforces the partial unique index only for active rows', async () => {
    const activeDup = await capture(() =>
      db
        .insert(notificationsSent)
        .values({ class_watch_id: W_C_2, notification_type: 'seat_available' })
    );
    expect(isUniqueViolation(activeDup)).toBe(true);

    await db.insert(notificationsSent).values({
      class_watch_id: W_C_2,
      notification_type: 'seat_available',
      is_active: false,
    });
    const history = await scalarCount(
      db
        .select({ n: count() })
        .from(notificationsSent)
        .where(
          and(
            eq(notificationsSent.class_watch_id, W_C_2),
            eq(notificationsSent.notification_type, 'seat_available')
          )
        )
    );
    expect(history).toBeGreaterThanOrEqual(2);
  });

  it('resets notifications for a section so users can be re-notified', async () => {
    await db.insert(notificationsSent).values({
      class_watch_id: W_A_MAIN,
      notification_type: 'seat_available',
    });
    await resetNotificationsForSection(db, REF_A, 'seat_available');
    const left = await scalarCount(
      db
        .select({ n: count() })
        .from(notificationsSent)
        .where(
          and(
            eq(notificationsSent.class_watch_id, W_A_MAIN),
            eq(notificationsSent.notification_type, 'seat_available')
          )
        )
    );
    expect(left).toBe(0);
  });
});

describe('deleteSectionAndWatches transactional cleanup', () => {
  it('hard-deletes watches (cascading notifications) and state atomically', async () => {
    const before = await scalarCount(
      db
        .select({ n: count() })
        .from(classWatches)
        .where(and(eq(classWatches.class_nbr, REF_C.class_nbr), eq(classWatches.term, TERM)))
    );
    expect(before).toBe(2);

    const result = await deleteSectionAndWatches(db, REF_C);
    expect(result).toEqual({ watchesDeleted: 2, stateDeleted: true });

    const watchesLeft = await scalarCount(
      db
        .select({ n: count() })
        .from(classWatches)
        .where(and(eq(classWatches.class_nbr, REF_C.class_nbr), eq(classWatches.term, TERM)))
    );
    expect(watchesLeft).toBe(0);
    expect(await readSectionCheckState(db, REF_C)).toBeNull();
    const notificationsLeft = await scalarCount(
      db
        .select({ n: count() })
        .from(notificationsSent)
        .where(inArray(notificationsSent.class_watch_id, [W_C_1, W_C_2]))
    );
    expect(notificationsLeft).toBe(0);
  });

  it('rolls back the whole transaction when any statement fails', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(classWatches).values({
          user_id: U_TX,
          class_nbr: REF_A.class_nbr,
          term: TERM,
          subject: SUBJECT,
          catalog_nbr: '310',
        });
        throw new Error('rollback-probe');
      })
    ).rejects.toThrow('rollback-probe');

    const left = await scalarCount(
      db
        .select({ n: count() })
        .from(classWatches)
        .where(and(eq(classWatches.user_id, U_TX), eq(classWatches.term, TERM)))
    );
    expect(left).toBe(0);
  });

  it('hard-deletes watches for past terms by term code', async () => {
    const deleted = await deletePastTermWatches(db, [TERM_OTHER]);
    expect(deleted).toBe(1);
    const left = await scalarCount(
      db.select({ n: count() }).from(classWatches).where(eq(classWatches.term, TERM_OTHER))
    );
    expect(left).toBe(0);
  });
});

describe('users mirror lifecycle', () => {
  const APP_ID = `clerk_${U_WEBHOOK}`;

  it('syncs a verified webhook payload into mirror + profile with consents', async () => {
    const synced = await syncUserMirrorFromClerkUser(
      db,
      userJson({
        public_metadata: { age_verified: true, agreed_to_terms: true },
      })
    );
    expect(synced).toBe(true);

    const verification = await readUserVerification(db, APP_ID, { cache: false });
    expect(verification).not.toBeNull();
    expect(verification?.email).toBe(mail('webhook'));
    expect(temporal(verification?.email_confirmed_at)).toBe(true);

    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.user_id, APP_ID));
    expect(profile.age_verified_at).not.toBeNull();
    expect(profile.agreed_to_terms_at).not.toBeNull();
  });

  it('keeps the earliest confirmation when the email is unchanged', async () => {
    await syncUserMirrorFromClerkUser(
      db,
      userJson({ email_addresses: [emailAddress('email_primary', mail('webhook'), 'unverified')] })
    );
    const verification = await readUserVerification(db, APP_ID, { cache: false });
    expect(verification?.email_confirmed_at).not.toBeNull();
  });

  it('resets confirmation when the address changes to an unverified one', async () => {
    await syncUserMirrorFromClerkUser(
      db,
      userJson({
        primary_email_address_id: 'email_secondary',
        email_addresses: [emailAddress('email_secondary', mail('webhook-two'), 'unverified')],
      })
    );
    const verification = await readUserVerification(db, APP_ID, { cache: false });
    expect(verification?.email).toBe(mail('webhook-two'));
    expect(verification?.email_confirmed_at).toBeNull();
  });

  it('soft-deletes by Clerk id and preserves the mirror row', async () => {
    const disabled = await softDeleteUserById(db, APP_ID);
    expect(disabled).toBe(1);

    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.user_id, APP_ID));
    expect(profile.is_disabled).toBe(true);
    expect(profile.disabled_at).not.toBeNull();
    expect(profile.notifications_enabled).toBe(false);
    expect(profile.unsubscribed_at).not.toBeNull();

    expect(profile.agreed_to_terms_at).not.toBeNull();

    const verification = await readUserVerification(db, APP_ID, { cache: false });
    expect(verification?.email).toBe(mail('webhook-two'));
  });
});

describe('onboarding persistence', () => {
  it('walks pending -> skipped through the skip_onboarding RPC', async () => {
    await db.insert(userProfiles).values({ user_id: U_ONBOARD });

    const pending = await readOnboardingState(db, U_ONBOARD);
    expect(pending.needs_onboarding).toBe(true);
    expect(pending.onboarding_completed_at).toBeNull();
    expect(pending.onboarding_skipped_at).toBeNull();

    const skipped = await skipOnboarding(db, U_ONBOARD);
    expect(skipped).not.toBeNull();
    expect(skipped?.onboarding_completed_at).toBeNull();
    expect(temporal(skipped?.onboarding_skipped_at)).toBe(true);

    const again = await skipOnboarding(db, U_ONBOARD);
    expect(again?.onboarding_skipped_at).toBe(skipped?.onboarding_skipped_at);

    const state = await readOnboardingState(db, U_ONBOARD);
    expect(state.needs_onboarding).toBe(false);
  });
});

describe('admin queries (representative RPC + builder results)', () => {
  it('paginates users with authoritative statuses and ISO-normalized timestamps', async () => {
    const expectedUsers = await scalarCount(
      db
        .select({ n: count() })
        .from(users)
        .where(like(users.id, `%${RUN}%`))
    );
    const mainWatches = await scalarCount(
      db.select({ n: count() }).from(classWatches).where(eq(classWatches.user_id, U_MAIN))
    );

    const page = await getUsersPage(db, { search: RUN, pageSize: 200 });
    expect(page.total).toBe(expectedUsers);
    expect(page.rows.length).toBe(page.total);

    const byId = new Map(page.rows.map((row) => [row.id, row]));
    const mainRow = byId.get(U_MAIN);
    expect(mainRow).toBeDefined();
    expect(mainRow?.watch_count).toBe(mainWatches);
    expect(mainRow?.notification_status).toBe('active');
    expect(isIsoZ(mainRow?.created_at)).toBe(true);
    expect(byId.get(U_BOUNCED)?.notification_status).toBe('bounced');
    expect(byId.get(U_DISABLED)?.notification_status).toBe('disabled');
    expect(byId.get(U_SPAM)?.notification_status).toBe('spam');
    expect(byId.get(U_UNSUB)?.notification_status).toBe('unsubscribed');
    expect(byId.get(`clerk_${U_WEBHOOK}`)?.notification_status).toBe('disabled');
    expect(byId.get(U_ADMIN)?.is_admin).toBe(true);

    const admins = await getUsersPage(db, { search: RUN, role: 'admin', pageSize: 200 });
    expect(admins.rows.length).toBeGreaterThanOrEqual(1);
    expect(admins.rows.every((row) => row.is_admin)).toBe(true);
  });

  it('paginates classes with SectionRef-scoped aggregates and global stats', async () => {
    const expectedStates = await scalarCount(
      db
        .select({ n: count() })
        .from(classStates)
        .where(like(classStates.class_nbr, `${RUN}%`))
    );

    const page = await getClassesPage(db, { search: RUN, pageSize: 200 });
    expect(page.total).toBe(expectedStates);
    expect(page.totalWatchers).toBe(5);
    expect(page.fullClasses).toBe(2);

    const rowA = page.rows.find((row) => row.class_nbr === REF_A.class_nbr);
    expect(rowA).toBeDefined();
    expect(rowA?.term).toBe(TERM);
    expect(rowA?.subject).toBe(SUBJECT);
    expect(rowA?.watcher_count).toBe(3);
    expect(rowA?.seat_emails).toBe(0);
    expect(rowA?.consecutive_not_found_count).toBe(0);
    expect(isIsoZ(rowA?.last_checked_at)).toBe(true);
    expect(isIsoZ(rowA?.last_changed_at)).toBe(true);
  });

  it('counts emails, users, admins, and distinct classes through BIGINT-safe paths', async () => {
    const myWatchIds = (
      await db
        .select({ id: classWatches.id })
        .from(classWatches)
        .where(like(classWatches.user_id, `%${RUN}%`))
    ).map((row) => row.id);
    const expectedEmails =
      myWatchIds.length > 0
        ? await scalarCount(
            db
              .select({ n: count() })
              .from(notificationsSent)
              .where(inArray(notificationsSent.class_watch_id, myWatchIds))
          )
        : 0;

    expect(await getTotalEmailsSent(db)).toBe(expectedEmails);

    const expectedProfiles = await scalarCount(
      db
        .select({ n: count() })
        .from(userProfiles)
        .where(like(userProfiles.user_id, `%${RUN}%`))
    );
    expect(await getTotalUsers(db)).toBeGreaterThanOrEqual(expectedProfiles);
    expect(await getAdminCount(db)).toBeGreaterThanOrEqual(1);

    const distinctMine = new Set(
      (
        await db
          .select({ class_nbr: classWatches.class_nbr })
          .from(classWatches)
          .where(like(classWatches.user_id, `%${RUN}%`))
      ).map((row) => row.class_nbr)
    );
    expect(await getTotalClassesWatched(db)).toBeGreaterThanOrEqual(distinctMine.size);
  });

  it('reports distinct subjects including the run-scoped fixture', async () => {
    const subjects = await getDistinctSubjects(db);
    expect(subjects).toContain(SUBJECT);
  });

  it('feeds recent activity with normalized ISO timestamps', async () => {
    const feed = await getRecentActivity(db, 500);
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.every((item) => isIsoZ(item.activityAt))).toBe(true);

    const registration = feed.find(
      (item) => item.type === 'user_registration' && item.userEmail === mail('admin')
    );
    expect(registration).toBeDefined();

    const aWatchFeed = feed.filter(
      (item) => item.type === 'new_watch' && item.classNbr === REF_A.class_nbr
    );
    expect(aWatchFeed.map((item) => item.userEmail).sort()).toEqual(
      [mail('main'), mail('bounced'), mail('disabled')].sort()
    );

    const emailSent = feed.find(
      (item) => item.type === 'email_sent' && item.classNbr === REF_ODD.class_nbr
    );
    expect(emailSent).toBeDefined();
    expect(emailSent?.notificationType).toBe('seat_available');
  });

  it('joins user watches with their class state (and null for stateless sections)', async () => {
    const mainWatches = await getUserWatches(db, U_MAIN);
    expect(mainWatches.map((w) => w.id).sort()).toEqual([W_A_MAIN, W_B_MAIN].sort());
    for (const watch of mainWatches) {
      expect(isIsoZ(watch.created_at)).toBe(true);
      expect(watch.class_state).not.toBeNull();
      expect(isIsoZ(watch.class_state?.last_checked_at)).toBe(true);
    }

    const xtWatches = await getUserWatches(db, U_XT);
    expect(xtWatches).toHaveLength(0);
  });
});
