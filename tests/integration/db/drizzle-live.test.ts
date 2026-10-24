import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, like, sql } from "drizzle-orm";
import type { EmailAddressJSON, UserJSON, VerificationJSON } from "@clerk/backend";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { AUTO_CLEANUP_THRESHOLD } from "@/lib/config";
import { getDb } from "@/lib/db";
import {
  PG_RAISE_EXCEPTION,
  PG_UNIQUE_VIOLATION,
  PG_UNDEFINED_FUNCTION,
  driverErrorMessage,
  getPgError,
  isRaisedException,
  isUndefinedFunction,
  isUniqueViolation,
} from "@/lib/db/pg-errors";
import {
  capConsecutiveNotFound,
  deletePastTermWatches,
  getClassWatchers,
  getMostWatchedClass,
  getNotificationWatchers,
  getSectionsToCheck,
  incrementConsecutiveNotFound,
  insertClassStateIfMissing,
  listExpiredClerkIdentities,
  purgeExpiredData,
  readAutoCleanupBreakerCounts,
  readSectionCheckState,
  retireSectionIfNotFound,
} from "@/lib/db/queries";
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
} from "@/lib/db/admin-queries";
import {
  readUserVerification,
  softDeleteUserById,
  syncUserMirrorFromClerkUser,
} from "@/lib/db/users";
import { classStates, classWatches, notificationsSent, userProfiles, users } from "@/lib/db/schema";
import { readOnboardingState, skipOnboarding } from "@/lib/onboarding";
import { pendingSectionNotifications } from "@/lib/db/schema";
import { deliverPendingNotifications, recordSectionCheck } from "@/lib/queue/pending-notifications";
import { processSection, retryDelaySeconds } from "@/lib/queue/process-section";
import { claimNotifications } from "@/lib/queue/notification-claims";
import { details as queueDetails, environment } from "../queue/fixtures";
import {
  deleteNotificationRecords,
  resetNotificationsForSection,
  tryRecordNotificationsBatch,
  upsertClassState,
} from "./helpers";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must point at a disposable PostgreSQL migrated with " +
      "`pnpm run db:migrate` (see the db project in vite.config.ts).",
  );
}

// SAFETY: DATABASE_URL is non-empty after the throw above; getDb reads only connectionString.
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

const REF_SEED = { class_nbr: `${RUN}7`, term: TERM };

const REF_LIMIT_1 = { class_nbr: `${RUN}8`, term: TERM };

const REF_LIMIT_2 = { class_nbr: `${RUN}9`, term: TERM };

const uid = (tag: string) => `${RUN}_u_${tag}`;

const mail = (tag: string) => `${RUN}.${tag}@emails.example.test`;

const U_MAIN = uid("main");

const U_BOUNCED = uid("bounced");

const U_DISABLED = uid("disabled");

const U_UNSUB = uid("unsub");

const U_SPAM = uid("spam");

const U_XT = uid("xterm");

const U_ODD = uid("odd");

const U_LIMIT = uid("limit");

const U_TX = uid("tx");

const U_ONBOARD = uid("onboard");

const U_WEBHOOK = uid("webhook");

const U_ADMIN = uid("admin");

const U_CRUD = uid("crud");

const U_CUTOFF = uid("cutoff");

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
      ].map((id) => ({ id, clerk_user_id: `clerk_${id}`, email: mail(id.slice(RUN.length + 3)) })),
    );

  await db.insert(userProfiles).values(
    [U_MAIN, U_BOUNCED, U_DISABLED, U_UNSUB, U_SPAM, U_XT, U_ODD, U_ADMIN].map((userId) => ({
      user_id: userId,
    })),
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
    catalog_nbr: "310",
    title: `Live Probe ${RUN}`,
    instructor_name: "Dr. Fixture",
    seats_available: seatsAvailable,
    seats_capacity: 30,
    non_reserved_seats: seatsAvailable > 0 ? seatsAvailable : null,
    location: "TEMPE",
    meeting_times: "MW 10:00-11:15",
    start_date: null,
    end_date: null,
    session_code: null,
  });

  await upsertClassState(db, REF_A, stateDetails(7), new Date());
  await upsertClassState(db, REF_B, stateDetails(5), new Date());
  await upsertClassState(db, REF_C, stateDetails(3), new Date());
  await upsertClassState(db, REF_FULL, stateDetails(0), new Date());

  const watch = async (userId: string, ref: { class_nbr: string; term: string }) => {
    const [row] = await db
      .insert(classWatches)
      .values({
        user_id: userId,
        class_nbr: ref.class_nbr,
        term: ref.term,
        subject: SUBJECT,
        catalog_nbr: "310",
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
    notification_type: "seat_available",
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
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    .safeParse(value).success;
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
  status: "verified" | "unverified" | null,
): EmailAddressJSON {
  const verification: VerificationJSON | null =
    status === null
      ? null
      : {
          object: "email_address",
          id: `${id}_ver`,
          status,
          strategy: "email_code",
          attempts: null,
          expire_at: null,
        };

  return {
    object: "email_address",
    id,
    email_address: address,
    verification,
    linked_to: [],
  };
}

function userJson(overrides: Partial<UserJSON>): UserJSON {
  return {
    object: "user",
    id: `clerk_${U_WEBHOOK}`,
    username: null,
    first_name: null,
    last_name: null,
    image_url: "https://img.clerk.com/default.png",
    has_image: false,
    primary_email_address_id: "email_primary",
    primary_phone_number_id: null,
    primary_web3_wallet_id: null,
    password_enabled: true,
    two_factor_enabled: false,
    totp_enabled: false,
    backup_code_enabled: false,
    email_addresses: [emailAddress("email_primary", mail("webhook"), "verified")],
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
    deprovisioned: false,
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
    timezone: null,
    ...overrides,
  };
}

describe("SQLSTATE helpers against real driver errors", () => {
  it("declares the exact PostgreSQL SQLSTATE constants", () => {
    expect(PG_UNIQUE_VIOLATION).toBe("23505");
    expect(PG_RAISE_EXCEPTION).toBe("P0001");
    expect(PG_UNDEFINED_FUNCTION).toBe("42883");
  });

  it("narrows a real unique violation (23505) through the cause chain", async () => {
    const error = await capture(() =>
      db.insert(classWatches).values({
        user_id: U_MAIN,
        class_nbr: REF_A.class_nbr,
        term: TERM,
        subject: SUBJECT,
        catalog_nbr: "310",
      }),
    );

    expect(isUniqueViolation(error)).toBe(true);
    expect(getPgError(error)?.code).toBe(PG_UNIQUE_VIOLATION);
  });

  it("keeps the duplicate-key message fallback for code-dropping intermediaries", () => {
    expect(isUniqueViolation(new Error('duplicate key value violates unique constraint "x"'))).toBe(
      true,
    );
    expect(isUniqueViolation(new Error("some other failure"))).toBe(false);
    expect(getPgError(null)).toBeNull();
    expect(getPgError("not-an-error")).toBeNull();
  });

  it("maps a PL/pgSQL RAISE EXCEPTION to P0001", async () => {
    // Any raising RPC works as the probe; the watch-limit guard raises before
    // it touches a row (p_max_watches < 1).
    const error = await capture(() =>
      db.execute(
        sql`SELECT * FROM public.create_class_watch_with_limit(
          ${U_LIMIT}::text,
          ${TERM}::text,
          ${SUBJECT}::text,
          '310'::text,
          ${`${RUN}1`}::text,
          0::integer
        )`,
      ),
    );

    expect(error).not.toBeNull();
    expect(driverErrorMessage(error)).toMatch(/Invalid watch limit/);
    expect(isRaisedException(error)).toBe(true);
    expect(getPgError(error)?.code).toBe(PG_RAISE_EXCEPTION);
  });

  it("maps a missing RPC to undefined function (42883)", async () => {
    const fnName = `definitely_missing_rpc_${RUN.replace(/-/g, "_")}`;
    const error = await capture(() => db.execute(sql`SELECT public.${sql.identifier(fnName)}()`));
    expect(error).not.toBeNull();
    expect(isUndefinedFunction(error)).toBe(true);
    expect(getPgError(error)?.code).toBe(PG_UNDEFINED_FUNCTION);
  });

  it("survives unrelated thrown values", () => {
    expect(isRaisedException(new Error("plain"))).toBe(false);
    expect(isUndefinedFunction(undefined)).toBe(false);
    expect(isUniqueViolation(42)).toBe(false);
  });
});

describe("wire formats under node-postgres", () => {
  it("returns int8 as a precision-safe string", async () => {
    const { rows } = await db.execute<{ c: string }>(
      sql`SELECT COUNT(*)::bigint AS c FROM class_watches`,
    );

    expect(z.string().safeParse(rows[0]?.c).success).toBe(true);
    expect(String(rows[0]?.c)).toMatch(/^\d+$/);
  });

  it("delivers timestamptz as parseable PG text (boundaries normalize to ISO)", async () => {
    const { rows } = await db.execute<{ t: string }>(sql`SELECT now()::timestamptz AS t`);
    expect(z.string().safeParse(rows[0]?.t).success).toBe(true);
    expect(temporal(rows[0]?.t)).toBe(true);
  });

  it("round-trips array-bound RPC parameters through the recipient read", async () => {
    expect(await getNotificationWatchers(db, REF_FULL)).toEqual([]);
  });
});

describe("Drizzle builder CRUD row shapes", () => {
  it("inserts, reads, updates, and deletes rows with schema-exact shapes", async () => {
    const [inserted] = await db
      .insert(users)
      .values({
        id: `${U_CRUD}_b`,
        email: mail("crud-b"),
      })
      .returning();

    expect(Object.keys(inserted).sort()).toEqual(
      [
        "clerk_user_id",
        "created_at",
        "email",
        "email_confirmed_at",
        "id",
        "last_sign_in_at",
      ].sort(),
    );
    expect(inserted.clerk_user_id).toBeNull();
    expect(inserted.last_sign_in_at).toBeNull();
    expect(temporal(inserted.created_at)).toBe(true);

    const stamp = new Date("2026-08-25T12:34:56.789Z").toISOString();
    await db.update(users).set({ last_sign_in_at: stamp }).where(eq(users.id, inserted.id));
    const [reread] = await db.select().from(users).where(eq(users.id, inserted.id));
    expect(reread.last_sign_in_at).not.toBeNull();
    expect(new Date(String(reread.last_sign_in_at)).getTime()).toBe(new Date(stamp).getTime());

    await db.delete(users).where(eq(users.id, inserted.id));

    const remaining = await scalarCount(
      db.select({ n: count() }).from(users).where(eq(users.id, inserted.id)),
    );

    expect(remaining).toBe(0);
  });

  it("projects profile defaults as real booleans and null timestamps", async () => {
    const [profile] = await db.insert(userProfiles).values({ user_id: U_CRUD }).returning();
    expect(Object.keys(profile).sort()).toEqual(
      [
        "age_verified_at",
        "agreed_to_terms_at",
        "created_at",
        "disabled_at",
        "email_bounced",
        "email_bounced_at",
        "id",
        "is_admin",
        "is_disabled",
        "notifications_enabled",
        "onboarding_completed_at",
        "onboarding_skipped_at",
        "spam_complained",
        "spam_complained_at",
        "unsubscribed_at",
        "updated_at",
        "user_id",
      ].sort(),
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

  it("enforces the per-user watch uniqueness and returns UUID/timestamp shapes", async () => {
    const [watch] = await db
      .insert(classWatches)
      .values({
        user_id: U_CRUD,
        class_nbr: `${RUN}7`,
        term: TERM,
        subject: SUBJECT,
        catalog_nbr: "310",
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
        catalog_nbr: "310",
      }),
    );

    expect(isUniqueViolation(duplicate)).toBe(true);

    const deleted = await db
      .delete(classWatches)
      .where(eq(classWatches.id, watch.id))
      .returning({ id: classWatches.id });

    expect(deleted).toHaveLength(1);
  });

  it("reads class_states rows back with exact column shapes after upsert", async () => {
    const [state] = await db
      .select()
      .from(classStates)
      .where(and(eq(classStates.class_nbr, REF_A.class_nbr), eq(classStates.term, TERM)));

    expect(Object.keys(state).sort()).toEqual(
      [
        "class_nbr",
        "consecutive_not_found_count",
        "catalog_nbr",
        "end_date",
        "id",
        "instructor_name",
        "last_changed_at",
        "last_checked_at",
        "location",
        "meeting_times",
        "non_reserved_seats",
        "seats_available",
        "seats_capacity",
        "session_code",
        "start_date",
        "subject",
        "term",
        "title",
      ].sort(),
    );
    expect(state.seats_available).toBe(7);
    expect(state.non_reserved_seats).toBe(7);
    expect(state.consecutive_not_found_count).toBe(0);
    expect(state.id).toMatch(UUID_RE);
    expect(temporal(state.last_checked_at)).toBe(true);
    expect(temporal(state.last_changed_at)).toBe(true);
  });
});

describe("upsertClassState / section-check pipeline ops", () => {
  it("updates an existing section without duplicating it", async () => {
    await upsertClassState(
      db,
      REF_A,
      {
        subject: SUBJECT,
        catalog_nbr: "310",
        title: `Live Probe ${RUN} II`,
        instructor_name: "Dr. Fixture",
        seats_available: 11,
        seats_capacity: 30,
        non_reserved_seats: 9,
        location: "TEMPE",
        meeting_times: "MW 10:00-11:15",
        start_date: null,
        end_date: null,
        session_code: null,
      },
      new Date(),
    );
    const baseline = await readSectionCheckState(db, REF_A);
    expect(baseline).toMatchObject({
      class_nbr: REF_A.class_nbr,
      term: TERM,
      seats_available: 11,
      non_reserved_seats: 9,
      instructor_name: "Dr. Fixture",
      consecutive_not_found_count: 0,
      last_checked_at: expect.any(String),
    });
  });

  it("returns null section-check state for unknown sections", async () => {
    expect(await readSectionCheckState(db, REF_INC)).toBeNull();
  });

  it("counts one strike per call, creating the missing row, including concurrent calls", async () => {
    // Regression: the old path raised 'Section not found' and let the application
    // insert a placeholder + retry on 23505 — which lost or double-counted
    // strikes under concurrency. The RPC now owns the placeholder insert.
    expect(await incrementConsecutiveNotFound(db, REF_INC)).toBe(1);
    expect(await incrementConsecutiveNotFound(db, REF_INC)).toBe(2);

    const concurrent = await Promise.all(
      Array.from({ length: 4 }, () => incrementConsecutiveNotFound(db, REF_INC)),
    );

    expect([...concurrent].sort((a, b) => a - b)).toEqual([3, 4, 5, 6]);

    const state = await readSectionCheckState(db, REF_INC);
    expect(state?.consecutive_not_found_count).toBe(6);
    expect(state?.last_checked_at).toBeDefined();
  });

  it("seeds a missing row but never clobbers pipeline state or the strike counter", async () => {
    const pipelineSnapshot = {
      subject: SUBJECT,
      catalog_nbr: "310",
      title: `Seed Probe ${RUN}`,
      instructor_name: "Dr. Fixture",
      seats_available: 11,
      seats_capacity: 30,
      non_reserved_seats: 9,
      location: "TEMPE",
      meeting_times: "MW 10:00-11:15",
      start_date: null,
      end_date: null,
      session_code: null,
    };

    await insertClassStateIfMissing(db, REF_SEED, pipelineSnapshot);
    expect((await readSectionCheckState(db, REF_SEED))?.seats_available).toBe(11);

    // Pipeline records a strike, then a watch creation seeds again with what
    // would be a clobbering snapshot.
    await incrementConsecutiveNotFound(db, REF_SEED);
    await insertClassStateIfMissing(db, REF_SEED, {
      ...pipelineSnapshot,
      title: "Stale Seed Snapshot",
      instructor_name: "Someone Else",
      seats_available: 99,
      non_reserved_seats: 99,
    });

    const row = await readSectionCheckState(db, REF_SEED);
    expect(row?.seats_available).toBe(11);
    expect(row?.non_reserved_seats).toBe(9);
    expect(row?.instructor_name).toBe("Dr. Fixture");
    expect(row?.consecutive_not_found_count).toBe(1);
  });

  it("moves last_changed_at for a seat-signal change but not for an unrelated field", async () => {
    const details = (overrides: { title?: string; non_reserved_seats?: number | null }) => ({
      subject: SUBJECT,
      catalog_nbr: "310",
      title: overrides.title ?? `Seed Probe ${RUN}`,
      instructor_name: "Dr. Fixture",
      seats_available: 11,
      seats_capacity: 30,
      non_reserved_seats: overrides.non_reserved_seats ?? 9,
      location: "TEMPE",
      meeting_times: "MW 10:00-11:15",
      start_date: null,
      end_date: null,
      session_code: null,
    });

    const selectStamps = async () => {
      const [row] = await db
        .select({
          last_checked_at: classStates.last_checked_at,
          last_changed_at: classStates.last_changed_at,
        })
        .from(classStates)
        .where(
          and(eq(classStates.class_nbr, REF_SEED.class_nbr), eq(classStates.term, REF_SEED.term)),
        );

      return row;
    };

    const before = await selectStamps();
    await upsertClassState(db, REF_SEED, details({ title: "Renamed Probe" }), new Date());
    const afterRename = await selectStamps();
    // mode: 'string' columns come back as driver text, so compare parsed dates.
    expect(afterRename?.last_changed_at).toBe(before?.last_changed_at);

    await upsertClassState(db, REF_SEED, details({ non_reserved_seats: 4 }), new Date());
    const afterSeats = await selectStamps();
    expect(new Date(afterSeats?.last_changed_at ?? 0).getTime()).toBeGreaterThan(
      new Date(afterRename?.last_changed_at ?? 0).getTime(),
    );
  });

  it("caps the counter and skips no-op writes", async () => {
    await capConsecutiveNotFound(db, REF_INC, 1);
    expect((await readSectionCheckState(db, REF_INC))?.consecutive_not_found_count).toBe(1);
    await capConsecutiveNotFound(db, REF_INC, 1);
    expect((await readSectionCheckState(db, REF_INC))?.consecutive_not_found_count).toBe(1);
  });

  it("reads cleanup breaker counts", async () => {
    const breaker = await readAutoCleanupBreakerCounts(db);
    expect(z.number().safeParse(breaker.total).success).toBe(true);
    expect(z.number().safeParse(breaker.flagged).success).toBe(true);
    expect(breaker.total).toBeGreaterThanOrEqual(5);
    expect(breaker.flagged).toBeGreaterThanOrEqual(1);
  });
});

describe("create_class_watch_with_limit RPC", () => {
  it("creates the watch and returns the full class_watches row", async () => {
    const { rows } = await db.execute<CreatedWatchRow>(
      sql`SELECT * FROM public.create_class_watch_with_limit(
        ${U_LIMIT}::text,
        ${TERM}::text,
        ${SUBJECT}::text,
        '310'::text,
        ${REF_LIMIT_1.class_nbr}::text,
        ${1}::integer
      )`,
    );

    const row = rows[0];
    expect(row).toBeDefined();

    for (const key of [
      "id",
      "user_id",
      "class_nbr",
      "term",
      "subject",
      "catalog_nbr",
      "created_at",
    ]) {
      expect(Object.keys(row)).toContain(key);
    }

    expect(row.user_id).toBe(U_LIMIT);
    expect(row.class_nbr).toBe(REF_LIMIT_1.class_nbr);
    expect(row.term).toBe(TERM);
    expect(String(row.id)).toMatch(UUID_RE);
    expect(temporal(row.created_at)).toBe(true);
  });

  it("raises MAX_WATCHES_EXCEEDED (P0001) once the limit is reached", async () => {
    const error = await capture(() =>
      db.execute(
        sql`SELECT * FROM public.create_class_watch_with_limit(
          ${U_LIMIT}::text,
          ${TERM}::text,
          ${SUBJECT}::text,
          '310'::text,
          ${REF_LIMIT_2.class_nbr}::text,
          ${1}::integer
        )`,
      ),
    );

    expect(error).not.toBeNull();
    expect(driverErrorMessage(error)).toMatch(/MAX_WATCHES_EXCEEDED/);
    expect(isRaisedException(error)).toBe(true);
  });
});

describe("watcher reads and eligibility RPCs", () => {
  it("lists only eligible watchers with normalized ISO timestamps", async () => {
    const watchers = await getClassWatchers(db, REF_A);
    const watcherIds = watchers.map((w) => w.watch_id);
    expect(watcherIds).toEqual([W_A_MAIN]);
    expect(watcherIds).not.toContain(W_A_BOUNCED);
    expect(watcherIds).not.toContain(W_A_DISABLED);
    expect(watchers[0]).toMatchObject({
      user_id: U_MAIN,
      watch_id: W_A_MAIN,
    });
    expect(watchers[0].email).toBe(mail("main"));
    expect(isIsoZ(watchers[0].created_at)).toBe(true);
  });

  it("scopes batch recipient reads to the requested sections AND term", async () => {
    const watchers = await getNotificationWatchers(db, REF_B);
    const watcherIds = watchers.map((w) => w.watch_id);
    expect(watcherIds).toEqual([W_B_MAIN]);
    expect(watcherIds).not.toContain(W_B_SPAM);
    expect(watcherIds).not.toContain(W_XT);
    expect(watchers[0].user_id).toBe(U_MAIN);
  });

  it("enumerates sections to check with stagger parity filtering", async () => {
    const mine = (refs: { class_nbr: string; term: string }[]) =>
      refs
        .flatMap((r) =>
          r.term === TERM || r.term === TERM_OTHER ? [`${r.term}:${r.class_nbr}`] : [],
        )
        .sort();

    expect(mine(await getSectionsToCheck(db, "all"))).toEqual(
      [
        `${TERM}:${REF_A.class_nbr}`,
        `${TERM}:${REF_B.class_nbr}`,
        `${TERM}:${REF_C.class_nbr}`,
        `${TERM}:${REF_ODD.class_nbr}`,
        `${TERM}:${REF_LIMIT_1.class_nbr}`,
        `${TERM_OTHER}:${REF_B_OTHER_TERM.class_nbr}`,
      ].sort(),
    );
    expect(mine(await getSectionsToCheck(db, "even"))).toEqual(
      [
        `${TERM}:${REF_A.class_nbr}`,
        `${TERM}:${REF_B.class_nbr}`,
        `${TERM}:${REF_C.class_nbr}`,
        `${TERM}:${REF_LIMIT_1.class_nbr}`,
        `${TERM_OTHER}:${REF_B_OTHER_TERM.class_nbr}`,
      ].sort(),
    );
    expect(mine(await getSectionsToCheck(db, "odd"))).toEqual([`${TERM}:${REF_ODD.class_nbr}`]);
  });

  it("picks the most-watched class by eligible watchers with deterministic tiebreak", async () => {
    expect(await getMostWatchedClass(db, TERM)).toEqual(REF_C);
    expect(await getMostWatchedClass(db, TERM_EMPTY)).toBeNull();
  });
});

describe("notification dedup lifecycle", () => {
  it("claims each watch once, frees expired slots, and rolls back claims", async () => {
    const first = await tryRecordNotificationsBatch(db, [W_C_1, W_C_2], "seat_available");
    expect(first.map((c) => c.watchId).sort()).toEqual([W_C_1, W_C_2].sort());

    const second = await tryRecordNotificationsBatch(db, [W_C_1, W_C_2], "seat_available");
    expect(second).toHaveLength(0);

    await db
      .update(notificationsSent)
      .set({ expires_at: "2020-01-01T00:00:00.000Z" })
      .where(inArray(notificationsSent.class_watch_id, [W_C_1, W_C_2]));

    const { rows: swept } = await db.execute<{ n: string }>(
      sql`SELECT public.expire_stale_notifications() AS n`,
    );

    expect(Number(swept[0]?.n)).toBeGreaterThanOrEqual(2);

    const inactive = await scalarCount(
      db
        .select({ n: count() })
        .from(notificationsSent)
        .where(
          and(
            inArray(notificationsSent.class_watch_id, [W_C_1, W_C_2]),
            eq(notificationsSent.is_active, false),
          ),
        ),
    );

    expect(inactive).toBe(2);

    const third = await tryRecordNotificationsBatch(db, [W_C_1, W_C_2], "seat_available");
    expect(third.map((c) => c.watchId).sort()).toEqual([W_C_1, W_C_2].sort());
  });

  it("rolls back failed sends by deleting only active claims", async () => {
    const deleted = await deleteNotificationRecords(db, [W_C_1], "seat_available");
    expect(deleted).toBe(1);

    const activeLeft = await scalarCount(
      db
        .select({ n: count() })
        .from(notificationsSent)
        .where(
          and(
            inArray(notificationsSent.class_watch_id, [W_C_1, W_C_2]),
            eq(notificationsSent.is_active, true),
          ),
        ),
    );

    expect(activeLeft).toBe(1);
  });

  it("enforces the partial unique index only for active rows", async () => {
    const activeDup = await capture(() =>
      db
        .insert(notificationsSent)
        .values({ class_watch_id: W_C_2, notification_type: "seat_available" }),
    );

    expect(isUniqueViolation(activeDup)).toBe(true);

    await db.insert(notificationsSent).values({
      class_watch_id: W_C_2,
      notification_type: "seat_available",
      is_active: false,
    });

    const history = await scalarCount(
      db
        .select({ n: count() })
        .from(notificationsSent)
        .where(
          and(
            eq(notificationsSent.class_watch_id, W_C_2),
            eq(notificationsSent.notification_type, "seat_available"),
          ),
        ),
    );

    expect(history).toBeGreaterThanOrEqual(2);
  });

  it("resets notifications for a section so users can be re-notified", async () => {
    await db.insert(notificationsSent).values({
      class_watch_id: W_A_MAIN,
      notification_type: "seat_available",
    });
    await resetNotificationsForSection(db, REF_A, "seat_available");

    const left = await scalarCount(
      db
        .select({ n: count() })
        .from(notificationsSent)
        .where(
          and(
            eq(notificationsSent.class_watch_id, W_A_MAIN),
            eq(notificationsSent.notification_type, "seat_available"),
          ),
        ),
    );

    expect(left).toBe(0);
  });
});

describe("locked section retirement", () => {
  it("retires only at the threshold, returning the deleted recipients and cascading notifications", async () => {
    const before = await scalarCount(
      db
        .select({ n: count() })
        .from(classWatches)
        .where(and(eq(classWatches.class_nbr, REF_C.class_nbr), eq(classWatches.term, TERM))),
    );

    expect(before).toBe(2);

    for (let i = 0; i < AUTO_CLEANUP_THRESHOLD - 1; i++) {
      await incrementConsecutiveNotFound(db, REF_C);
    }

    expect(await retireSectionIfNotFound(db, REF_C, AUTO_CLEANUP_THRESHOLD)).toMatchObject({
      retired: false,
      watches_deleted: 0,
      watchers: [],
    });
    expect(await getClassWatchers(db, REF_C)).toHaveLength(2);
    await incrementConsecutiveNotFound(db, REF_C);
    const result = await retireSectionIfNotFound(db, REF_C, AUTO_CLEANUP_THRESHOLD);
    expect(result).toMatchObject({
      retired: true,
      watches_deleted: 2,
      class_info: { subject: SUBJECT, catalog_nbr: "310", title: `Live Probe ${RUN}` },
    });
    expect(result.watchers.map((watcher) => watcher.watch_id).sort()).toEqual(
      [W_C_1, W_C_2].sort(),
    );

    const watchesLeft = await scalarCount(
      db
        .select({ n: count() })
        .from(classWatches)
        .where(and(eq(classWatches.class_nbr, REF_C.class_nbr), eq(classWatches.term, TERM))),
    );

    expect(watchesLeft).toBe(0);
    expect(await readSectionCheckState(db, REF_C)).toBeNull();

    const notificationsLeft = await scalarCount(
      db
        .select({ n: count() })
        .from(notificationsSent)
        .where(inArray(notificationsSent.class_watch_id, [W_C_1, W_C_2])),
    );

    expect(notificationsLeft).toBe(0);
  });

  it("does not retire if a successful observation reset the third strike", async () => {
    const ref = { class_nbr: `${RUN}-retirement-reset`, term: TERM };
    await db.insert(classWatches).values({
      ...ref,
      user_id: U_MAIN,
      subject: SUBJECT,
      catalog_nbr: "110",
    });

    for (let i = 0; i < AUTO_CLEANUP_THRESHOLD; i++) {
      await incrementConsecutiveNotFound(db, ref);
    }

    await recordSectionCheck(db, ref, queueDetails, new Date());
    expect(await retireSectionIfNotFound(db, ref, AUTO_CLEANUP_THRESHOLD)).toEqual({
      retired: false,
      watches_deleted: 0,
      class_info: null,
      watchers: [],
    });
    expect(await getClassWatchers(db, ref)).toHaveLength(1);
    expect((await readSectionCheckState(db, ref))?.consecutive_not_found_count).toBe(0);
  });

  it("rolls back the whole transaction when any statement fails", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(classWatches).values({
          user_id: U_TX,
          class_nbr: REF_A.class_nbr,
          term: TERM,
          subject: SUBJECT,
          catalog_nbr: "310",
        });
        throw new Error("rollback-probe");
      }),
    ).rejects.toThrow("rollback-probe");

    const left = await scalarCount(
      db
        .select({ n: count() })
        .from(classWatches)
        .where(and(eq(classWatches.user_id, U_TX), eq(classWatches.term, TERM))),
    );

    expect(left).toBe(0);
  });

  it("hard-deletes watches for past terms by term code", async () => {
    const deleted = await deletePastTermWatches(db, [TERM_OTHER]);
    expect(deleted).toBe(1);

    const left = await scalarCount(
      db.select({ n: count() }).from(classWatches).where(eq(classWatches.term, TERM_OTHER)),
    );

    expect(left).toBe(0);
  });
});

describe("users mirror lifecycle", () => {
  const APP_ID = `clerk_${U_WEBHOOK}`;

  it("syncs a verified webhook payload into mirror + profile with consents", async () => {
    const synced = await syncUserMirrorFromClerkUser(
      db,
      userJson({
        public_metadata: { age_verified: true, agreed_to_terms: true },
      }),
    );

    expect(synced).toBe(true);

    const verification = await readUserVerification(db, APP_ID, { cache: false });
    expect(verification).not.toBeNull();
    expect(verification?.email).toBe(mail("webhook"));
    expect(temporal(verification?.email_confirmed_at)).toBe(true);

    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.user_id, APP_ID));
    expect(profile.age_verified_at).not.toBeNull();
    expect(profile.agreed_to_terms_at).not.toBeNull();
  });

  it("keeps the earliest confirmation when the email is unchanged", async () => {
    await syncUserMirrorFromClerkUser(
      db,
      userJson({ email_addresses: [emailAddress("email_primary", mail("webhook"), "unverified")] }),
    );
    const verification = await readUserVerification(db, APP_ID, { cache: false });
    expect(verification?.email_confirmed_at).not.toBeNull();
  });

  it("resets confirmation when the address changes to an unverified one", async () => {
    await syncUserMirrorFromClerkUser(
      db,
      userJson({
        primary_email_address_id: "email_secondary",
        email_addresses: [emailAddress("email_secondary", mail("webhook-two"), "unverified")],
      }),
    );
    const verification = await readUserVerification(db, APP_ID, { cache: false });
    expect(verification?.email).toBe(mail("webhook-two"));
    expect(verification?.email_confirmed_at).toBeNull();
  });

  it("soft-deletes by Clerk id and preserves the mirror row", async () => {
    const disabled = await softDeleteUserById(db, APP_ID);
    expect(disabled).toBe(1);

    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.user_id, APP_ID));
    expect(profile.is_disabled).toBe(true);
    expect(profile.disabled_at).not.toBeNull();
    expect(profile.notifications_enabled).toBe(false);
    expect(profile.unsubscribed_at).not.toBeNull();

    expect(profile.agreed_to_terms_at).not.toBeNull();

    const verification = await readUserVerification(db, APP_ID, { cache: false });
    expect(verification?.email).toBe(mail("webhook-two"));
  });
});

describe("onboarding persistence", () => {
  it("walks pending -> skipped through the skip_onboarding RPC", async () => {
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

describe("admin queries (representative RPC + builder results)", () => {
  it("paginates users with authoritative statuses and ISO-normalized timestamps", async () => {
    const expectedUsers = await scalarCount(
      db
        .select({ n: count() })
        .from(users)
        .where(like(users.id, `%${RUN}%`)),
    );

    const mainWatches = await scalarCount(
      db.select({ n: count() }).from(classWatches).where(eq(classWatches.user_id, U_MAIN)),
    );

    const page = await getUsersPage(db, { search: RUN, pageSize: 200 });
    expect(page.total).toBe(expectedUsers);
    expect(page.rows.length).toBe(page.total);

    const byId = new Map(page.rows.map((row) => [row.id, row]));
    const mainRow = byId.get(U_MAIN);
    expect(mainRow).toBeDefined();
    expect(mainRow?.watch_count).toBe(mainWatches);
    expect(mainRow?.notification_status).toBe("active");
    expect(isIsoZ(mainRow?.created_at)).toBe(true);
    expect(byId.get(U_BOUNCED)?.notification_status).toBe("bounced");
    expect(byId.get(U_DISABLED)?.notification_status).toBe("disabled");
    expect(byId.get(U_SPAM)?.notification_status).toBe("spam");
    expect(byId.get(U_UNSUB)?.notification_status).toBe("unsubscribed");
    expect(byId.get(`clerk_${U_WEBHOOK}`)?.notification_status).toBe("disabled");
    expect(byId.get(U_ADMIN)?.is_admin).toBe(true);

    const admins = await getUsersPage(db, { search: RUN, role: "admin", pageSize: 200 });
    expect(admins.rows.length).toBeGreaterThanOrEqual(1);
    expect(admins.rows.every((row) => row.is_admin)).toBe(true);
  });

  it("paginates classes with SectionRef-scoped aggregates and global stats", async () => {
    const expectedStates = await scalarCount(
      db
        .select({ n: count() })
        .from(classStates)
        .where(like(classStates.class_nbr, `${RUN}%`)),
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

  it("counts emails, users, admins, and distinct classes through BIGINT-safe paths", async () => {
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
              .where(inArray(notificationsSent.class_watch_id, myWatchIds)),
          )
        : 0;

    expect(await getTotalEmailsSent(db)).toBe(expectedEmails);

    const expectedProfiles = await scalarCount(
      db
        .select({ n: count() })
        .from(userProfiles)
        .where(like(userProfiles.user_id, `%${RUN}%`)),
    );

    expect(await getTotalUsers(db)).toBeGreaterThanOrEqual(expectedProfiles);
    expect(await getAdminCount(db)).toBeGreaterThanOrEqual(1);

    const distinctMine = new Set(
      (
        await db
          .select({ class_nbr: classWatches.class_nbr })
          .from(classWatches)
          .where(like(classWatches.user_id, `%${RUN}%`))
      ).map((row) => row.class_nbr),
    );

    expect(await getTotalClassesWatched(db)).toBeGreaterThanOrEqual(distinctMine.size);
  });

  it("reports distinct subjects including the run-scoped fixture", async () => {
    const subjects = await getDistinctSubjects(db);
    expect(subjects).toContain(SUBJECT);
  });

  it("feeds recent activity with normalized ISO timestamps", async () => {
    const feed = await getRecentActivity(db, 500);
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.every((item) => isIsoZ(item.activityAt))).toBe(true);

    const registration = feed.find(
      (item) => item.type === "user_registration" && item.userEmail === mail("admin"),
    );

    expect(registration).toBeDefined();

    const aWatchFeed = feed.filter(
      (item) => item.type === "new_watch" && item.classNbr === REF_A.class_nbr,
    );

    expect(aWatchFeed.map((item) => item.userEmail).sort()).toEqual(
      [mail("main"), mail("bounced"), mail("disabled")].sort(),
    );

    const emailSent = feed.find(
      (item) => item.type === "email_sent" && item.classNbr === REF_ODD.class_nbr,
    );

    expect(emailSent).toBeDefined();
    expect(emailSent?.notificationType).toBe("seat_available");
  });

  it("joins user watches with their class state (and null for stateless sections)", async () => {
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

describe("notification claim races", () => {
  const seedWatch = async (ref: { class_nbr: string; term: string }) => {
    const [row] = await db
      .insert(classWatches)
      .values({
        user_id: U_CRUD,
        class_nbr: ref.class_nbr,
        term: ref.term,
        subject: SUBJECT,
        catalog_nbr: "310",
      })
      .returning({ id: classWatches.id });

    return row.id;
  };

  it("lets exactly one of two concurrent claims win a watch", async () => {
    const watchId = await seedWatch(REF_LIMIT_2);

    try {
      const [first, second] = await Promise.all([
        tryRecordNotificationsBatch(db, [watchId], "seat_available"),
        tryRecordNotificationsBatch(db, [watchId], "seat_available"),
      ]);

      expect(first.length + second.length).toBe(1);

      const activeClaims = await scalarCount(
        db
          .select({ n: count() })
          .from(notificationsSent)
          .where(
            and(
              eq(notificationsSent.class_watch_id, watchId),
              eq(notificationsSent.is_active, true),
            ),
          ),
      );

      expect(activeClaims).toBe(1);
    } finally {
      await db.delete(classWatches).where(eq(classWatches.id, watchId));
    }
  });

  it("claims a free slot again when only an inactive history row is left unexpired", async () => {
    const watchId = await seedWatch(REF_LIMIT_1);

    try {
      await db.insert(notificationsSent).values({
        class_watch_id: watchId,
        notification_type: "seat_available",
        is_active: false,
      });

      const claimed = await tryRecordNotificationsBatch(db, [watchId], "seat_available");

      expect(claimed.map((claim) => claim.watchId)).toEqual([watchId]);
    } finally {
      await db.delete(classWatches).where(eq(classWatches.id, watchId));
    }
  });

  it("skips a watch deleted mid-claim instead of failing the whole batch", async () => {
    const doomedId = await seedWatch(REF_LIMIT_1);
    const survivorId = await seedWatch(REF_LIMIT_2);

    try {
      await db.delete(classWatches).where(eq(classWatches.id, doomedId));

      const claimed = await tryRecordNotificationsBatch(
        db,
        [doomedId, survivorId],
        "instructor_assigned",
      );

      expect(claimed.map((claim) => claim.watchId)).toEqual([survivorId]);
    } finally {
      await db.delete(classWatches).where(inArray(classWatches.id, [doomedId, survivorId]));
    }
  });
});

describe("durable Section Check notifications", () => {
  async function seedIntent(suffix: string) {
    const ref = { class_nbr: `${RUN}-pending-${suffix}`, term: TERM };
    await recordSectionCheck(
      db,
      ref,
      { ...queueDetails, seats_available: 0, non_reserved_seats: 0 },
      new Date(Date.now() - 1000),
    );
    await db
      .insert(classWatches)
      .values({ ...ref, user_id: U_MAIN, subject: SUBJECT, catalog_nbr: "110" });
    expect(await recordSectionCheck(db, ref, queueDetails, new Date())).toEqual({
      applied: true,
      intentCreated: true,
    });
    expect((await readSectionCheckState(db, ref))?.has_pending_intent).toBe(true);

    return ref;
  }

  it("resumes partial delivery before the cycle guard without fetching ASU", async () => {
    vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", "test-signing-secret");

    try {
      const ref = await seedIntent("retry");
      const env = environment();
      env.send.mockRejectedValueOnce(new Error("temporary provider failure"));
      await expect(deliverPendingNotifications(db, ref, env)).rejects.toThrow("incomplete");
      expect(
        await db
          .select()
          .from(pendingSectionNotifications)
          .where(eq(pendingSectionNotifications.class_nbr, ref.class_nbr)),
      ).toHaveLength(1);
      const fetchClass = vi.fn();

      const outcome = await processSection(
        db,
        { ...ref, cycle: new Date(Date.now() - 5000).toISOString() },
        env,
        { fetchClass },
      );

      expect(outcome).toMatchObject({ disposition: "ack", result: { emailsSent: 1 } });
      expect(fetchClass).not.toHaveBeenCalled();
      expect(env.send).toHaveBeenCalledTimes(2);
      expect(
        await db
          .select()
          .from(pendingSectionNotifications)
          .where(eq(pendingSectionNotifications.class_nbr, ref.class_nbr)),
      ).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reclaims unsent intent-owned records after a worker dies or rollback fails", async () => {
    vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", "test-signing-secret");

    try {
      const ref = await seedIntent("crash");

      const [intent] = await db
        .select()
        .from(pendingSectionNotifications)
        .where(eq(pendingSectionNotifications.class_nbr, ref.class_nbr));

      const leaseId = randomUUID();
      await db
        .update(pendingSectionNotifications)
        .set({ lease_id: leaseId, leased_until: new Date(Date.now() + 60000).toISOString() })
        .where(eq(pendingSectionNotifications.id, intent.id));
      const watchers = await getNotificationWatchers(db, ref);
      expect(
        await claimNotifications(
          db,
          watchers.map((w) => w.watch_id),
          "seat_available",
          { id: intent.id, leaseId },
        ),
      ).toHaveLength(1);
      // Model owner death: its active claim survives, but its lease expires.
      await db
        .update(pendingSectionNotifications)
        .set({ leased_until: new Date(Date.now() - 1000).toISOString() })
        .where(eq(pendingSectionNotifications.id, intent.id));
      const env = environment();
      expect(await deliverPendingNotifications(db, ref, env)).toBe(1);
      expect(env.send).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("retains confirmed successes while retrying the failed recipient", async () => {
    vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", "test-signing-secret");

    try {
      const ref = await seedIntent("partial");
      await db
        .insert(classWatches)
        .values({ ...ref, user_id: U_XT, subject: SUBJECT, catalog_nbr: "110" });
      const env = environment();
      env.send.mockRejectedValueOnce(new Error("temporary"));
      await expect(deliverPendingNotifications(db, ref, env)).rejects.toThrow("incomplete");
      expect(await deliverPendingNotifications(db, ref, env)).toBe(1);
      expect(env.send).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("expires stale intent and continues observing seats instead of sending old alerts", async () => {
    const ref = await seedIntent("expired");
    await db
      .update(pendingSectionNotifications)
      .set({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .where(eq(pendingSectionNotifications.class_nbr, ref.class_nbr));
    const env = environment();

    const fetchClass = vi
      .fn()
      .mockResolvedValue({ ...queueDetails, seats_available: 0, non_reserved_seats: 0 });

    expect(await processSection(db, ref, env, { fetchClass })).toMatchObject({
      disposition: "ack",
    });
    expect(fetchClass).toHaveBeenCalledOnce();
    expect(env.send).not.toHaveBeenCalled();
    expect((await readSectionCheckState(db, ref))?.seats_available).toBe(0);
  });

  it("refuses a concurrent owner while delivery is in flight", async () => {
    vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", "test-signing-secret");

    try {
      const ref = await seedIntent("concurrent");
      const env = environment();
      const sending = Promise.withResolvers<void>();
      const finish = Promise.withResolvers<{ messageId: string }>();
      env.send.mockImplementationOnce(() => {
        sending.resolve();

        return finish.promise;
      });
      const first = deliverPendingNotifications(db, ref, env);
      await sending.promise;

      try {
        const [leased] = await db
          .select()
          .from(pendingSectionNotifications)
          .where(eq(pendingSectionNotifications.class_nbr, ref.class_nbr));

        expect(Date.parse(leased.leased_until ?? "")).toBeLessThan(Date.parse(leased.expires_at));
        const busy = await processSection(db, ref, env);
        expect(busy.disposition).toBe("retry");
        expect(retryDelaySeconds(busy, 1)).toBeGreaterThan(900);
        expect(retryDelaySeconds(busy, 1)).toBeLessThanOrEqual(960);
        await expect(deliverPendingNotifications(db, ref, env)).rejects.toThrow(
          "already in progress",
        );
        expect((await recordSectionCheck(db, ref, queueDetails, new Date())).applied).toBe(false);
      } finally {
        finish.resolve({ messageId: "delivered" });
      }

      expect(await first).toBe(1);
      expect(env.send).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("commits state and intent in the same transaction and guards first observations", async () => {
    const ref = { class_nbr: `${RUN}-pending-atomic`, term: TERM };
    expect(
      (await recordSectionCheck(db, ref, queueDetails, new Date(Date.now() - 2000))).applied,
    ).toBe(true);
    expect(
      await db
        .select()
        .from(pendingSectionNotifications)
        .where(eq(pendingSectionNotifications.class_nbr, ref.class_nbr)),
    ).toHaveLength(0);
    await recordSectionCheck(
      db,
      ref,
      { ...queueDetails, seats_available: 0, non_reserved_seats: 0 },
      new Date(Date.now() - 1000),
    );
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT * FROM public.record_section_observation(${ref.class_nbr}, ${ref.term}, ${JSON.stringify(queueDetails)}::jsonb, now())`,
        );
        throw new Error("rollback probe");
      }),
    ).rejects.toThrow("rollback probe");
    expect((await readSectionCheckState(db, ref))?.seats_available).toBe(0);
    expect(
      await db
        .select()
        .from(pendingSectionNotifications)
        .where(eq(pendingSectionNotifications.class_nbr, ref.class_nbr)),
    ).toHaveLength(0);
  });

  it("does not notify on the first real observation after NotFound placeholders", async () => {
    const ref = { class_nbr: `${RUN}-placeholder`, term: TERM };
    await incrementConsecutiveNotFound(db, ref);
    await db.insert(classWatches).values({
      ...ref,
      user_id: U_MAIN,
      subject: SUBJECT,
      catalog_nbr: "110",
    });

    expect(await recordSectionCheck(db, ref, queueDetails, new Date())).toEqual({
      applied: true,
      intentCreated: false,
    });
    const env = environment();
    expect(await deliverPendingNotifications(db, ref, env)).toBe(0);
    expect(env.send).not.toHaveBeenCalled();
    expect((await readSectionCheckState(db, ref))?.consecutive_not_found_count).toBe(0);
  });

  it("resets both notification types atomically and rejects stale observations", async () => {
    const ref = { class_nbr: `${RUN}-pending-reset`, term: TERM };
    await recordSectionCheck(
      db,
      ref,
      { ...queueDetails, instructor_name: "Professor" },
      new Date(Date.now() - 2000),
    );

    const [watch] = await db
      .insert(classWatches)
      .values({ ...ref, user_id: U_MAIN, subject: SUBJECT, catalog_nbr: "110" })
      .returning();

    await tryRecordNotificationsBatch(db, [watch.id], "seat_available");
    await tryRecordNotificationsBatch(db, [watch.id], "instructor_assigned");
    const closed = { ...queueDetails, seats_available: 0, non_reserved_seats: 0 };
    expect((await recordSectionCheck(db, ref, closed, new Date(Date.now() - 5000))).applied).toBe(
      false,
    );
    expect(
      await db
        .select()
        .from(notificationsSent)
        .where(eq(notificationsSent.class_watch_id, watch.id)),
    ).toHaveLength(2);
    expect(await recordSectionCheck(db, ref, closed, new Date())).toEqual({
      applied: true,
      intentCreated: false,
    });
    expect((await readSectionCheckState(db, ref))?.has_pending_intent).toBe(false);
    expect(
      await db
        .select()
        .from(notificationsSent)
        .where(eq(notificationsSent.class_watch_id, watch.id)),
    ).toHaveLength(0);
  });

  it("stores ASU session dates with each accepted observation", async () => {
    const ref = { class_nbr: `${RUN}-dates`, term: TERM };

    const dated = {
      ...queueDetails,
      start_date: "2026-08-20",
      end_date: "2026-12-04",
      session_code: "C",
    };

    const readDates = async () =>
      (
        await db
          .select({
            start_date: classStates.start_date,
            end_date: classStates.end_date,
            session_code: classStates.session_code,
          })
          .from(classStates)
          .where(and(eq(classStates.class_nbr, ref.class_nbr), eq(classStates.term, ref.term)))
      )[0];

    await insertClassStateIfMissing(db, ref, dated);
    expect(await readDates()).toEqual({
      start_date: "2026-08-20",
      end_date: "2026-12-04",
      session_code: "C",
    });
    expect(
      (await recordSectionCheck(db, ref, { ...dated, end_date: "2026-10-09" }, new Date())).applied,
    ).toBe(true);
    expect((await readDates())?.end_date).toBe("2026-10-09");
    expect((await recordSectionCheck(db, ref, queueDetails, new Date())).applied).toBe(true);
    expect(await readDates()).toEqual({
      start_date: "2026-08-20",
      end_date: "2026-10-09",
      session_code: null,
    });

    const { rows } = await db.execute<{ cutoff: string }>(
      sql`SELECT public.section_alert_cutoff(start_date, end_date)::text AS cutoff
        FROM public.class_states WHERE class_nbr = ${ref.class_nbr} AND term = ${ref.term}`,
    );

    expect(rows[0].cutoff).toBe("2026-09-04");
  });
});

describe("section alert cutoff", () => {
  const cutoff = async (start: string | null, end: string | null) => {
    const { rows } = await db.execute<{ cutoff: string | null }>(
      sql`SELECT public.section_alert_cutoff(${start}::date, ${end}::date)::text AS cutoff`,
    );

    return rows[0]?.cutoff;
  };

  const ended = async (start: string | null, end: string | null, now: string) => {
    const { rows } = await db.execute<{ ended: boolean }>(
      sql`SELECT public.section_alerts_ended(${start}::date, ${end}::date, ${now}::timestamptz) AS ended`,
    );

    return rows[0]?.ended;
  };

  it.each([
    ["full semester: add deadline (start + 6) + 14", "2026-08-20", "2026-12-04", "2026-09-09"],
    ["7.5-week session: add deadline (start + 1) + 14", "2026-08-20", "2026-10-09", "2026-09-04"],
    ["exactly 70 days is still a short session", "2026-08-20", "2026-10-29", "2026-09-04"],
    ["71 days is a full session", "2026-08-20", "2026-10-30", "2026-09-09"],
    ["capped at the class end date", "2026-08-20", "2026-08-28", "2026-08-28"],
    ["unknown start date", null, "2026-12-04", null],
    ["unknown end date", "2026-08-20", null, null],
  ])("computes the cutoff: %s", async (_label, start, end, expected) => {
    expect(await cutoff(start, end)).toBe(expected);
  });

  it("ends alerts after the cutoff day in America/Phoenix, not UTC", async () => {
    // Cutoff 2026-09-09; Phoenix is UTC-7 year-round.
    expect(await ended("2026-08-20", "2026-12-04", "2026-09-10T06:59:59Z")).toBe(false);
    expect(await ended("2026-08-20", "2026-12-04", "2026-09-10T07:00:00Z")).toBe(true);
  });

  it("never ends alerts for sections with unknown dates", async () => {
    expect(await ended(null, "2020-12-04", "2026-10-17T12:00:00Z")).toBe(false);
    expect(await ended("2020-08-20", null, "2026-10-17T12:00:00Z")).toBe(false);
  });

  it("stops checking sections once their add-deadline cutoff has passed", async () => {
    const term = `${RUN}-t4`;

    const dated = (start_date: string | null, end_date: string | null) => ({
      ...queueDetails,
      start_date,
      end_date,
    });

    const sections = {
      ended: { ref: { class_nbr: `${RUN}10`, term }, details: dated("2020-08-20", "2020-12-04") },
      live: { ref: { class_nbr: `${RUN}12`, term }, details: dated("2099-08-20", "2099-12-04") },
      unknown: { ref: { class_nbr: `${RUN}14`, term }, details: dated(null, "2020-12-04") },
    };

    await db
      .insert(users)
      .values({ id: U_CUTOFF, clerk_user_id: `clerk_${U_CUTOFF}`, email: mail("cutoff") });

    for (const { ref, details } of Object.values(sections)) {
      await insertClassStateIfMissing(db, ref, details);
      await db
        .insert(classWatches)
        .values({ ...ref, user_id: U_CUTOFF, subject: SUBJECT, catalog_nbr: "110" });
    }

    const checked = (await getSectionsToCheck(db, "all")).flatMap((r) =>
      r.term === term ? [r.class_nbr] : [],
    );

    expect(checked.sort()).toEqual(
      [sections.live.ref.class_nbr, sections.unknown.ref.class_nbr].sort(),
    );

    const ended = Object.fromEntries(
      (await getUserWatches(db, U_CUTOFF)).map((w) => [w.class_nbr, w.class_state?.alerts_ended]),
    );

    expect(ended).toEqual({
      [sections.ended.ref.class_nbr]: true,
      [sections.live.ref.class_nbr]: false,
      [sections.unknown.ref.class_nbr]: false,
    });
  });
});

describe("purge_expired_data retention", () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  it("lists the Clerk ids of accounts past the 30-day mark, oldest first, up to the limit", async () => {
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
    const expired = uid("clerk-expired");
    const nearCutoff = uid("clerk-near");
    const noClerkRow = uid("clerk-none");
    const clerkAsId = `user_${RUN}_asid`;
    const userishLegacyId = `userX${RUN}`;

    await db.insert(users).values([
      { id: expired, clerk_user_id: `clerk_${expired}`, email: mail(expired) },
      { id: nearCutoff, clerk_user_id: `clerk_${nearCutoff}`, email: mail(nearCutoff) },
      { id: noClerkRow, email: mail(noClerkRow) },
      { id: clerkAsId, email: mail(clerkAsId) },
      { id: userishLegacyId, email: mail(userishLegacyId) },
    ]);
    await db.insert(userProfiles).values([
      { user_id: expired, is_disabled: true, disabled_at: hoursAgo(24 * 31) },
      { user_id: nearCutoff, is_disabled: true, disabled_at: hoursAgo(24 * 30 - 0.5) },
      { user_id: noClerkRow, is_disabled: true, disabled_at: hoursAgo(24 * 31) },
      { user_id: clerkAsId, is_disabled: true, disabled_at: hoursAgo(24 * 32) },
      { user_id: userishLegacyId, is_disabled: true, disabled_at: hoursAgo(24 * 31) },
    ]);

    const ids = await listExpiredClerkIdentities(db, 1_000);

    expect(ids).toContain(`clerk_${expired}`);
    expect(ids).toContain(clerkAsId);
    expect(ids.indexOf(clerkAsId)).toBeLessThan(ids.indexOf(`clerk_${expired}`));
    expect(ids).not.toContain(`clerk_${nearCutoff}`);
    expect(ids).not.toContain(noClerkRow);
    // `_` is literal: a legacy id that merely starts with "user" has no Clerk identity.
    expect(ids).not.toContain(userishLegacyId);
    expect(await listExpiredClerkIdentities(db, 1)).toHaveLength(1);
  });

  it("deletes data past the privacy policy's windows and keeps everything inside them", async () => {
    const term = `${RUN}-t5`;
    const expiredUser = uid("purge-expired");
    const unconfirmedUser = uid("purge-unconfirmed");
    const legacyUser = uid("purge-legacy");
    const recentUser = uid("purge-recent");
    const activeUser = uid("purge-active");

    await db.insert(users).values([
      ...[expiredUser, unconfirmedUser, recentUser, activeUser].map((id) => ({
        id,
        clerk_user_id: `clerk_${id}`,
        email: mail(id),
      })),
      { id: legacyUser, email: mail(legacyUser) },
    ]);
    await db
      .insert(userProfiles)
      .values([
        { user_id: expiredUser, is_disabled: true, disabled_at: daysAgo(31) },
        { user_id: unconfirmedUser, is_disabled: true, disabled_at: daysAgo(31) },
        { user_id: legacyUser, is_disabled: true, disabled_at: daysAgo(31) },
        { user_id: recentUser, is_disabled: true, disabled_at: daysAgo(29) },
        { user_id: activeUser },
      ]);

    const watched = { class_nbr: `${RUN}20`, term };
    const unwatchedStale = { class_nbr: `${RUN}22`, term };
    const unwatchedFresh = { class_nbr: `${RUN}24`, term };

    for (const ref of [watched, unwatchedStale, unwatchedFresh])
      await insertClassStateIfMissing(db, ref, queueDetails);

    await db
      .update(classStates)
      .set({ last_checked_at: daysAgo(200) })
      .where(inArray(classStates.class_nbr, [watched.class_nbr, unwatchedStale.class_nbr]));

    const [watch] = await db
      .insert(classWatches)
      .values({ ...watched, user_id: activeUser, subject: SUBJECT, catalog_nbr: "120" })
      .returning({ id: classWatches.id });

    await db.insert(notificationsSent).values([
      {
        class_watch_id: watch.id,
        notification_type: "seat_available",
        sent_at: daysAgo(400),
        is_active: false,
      },
      {
        class_watch_id: watch.id,
        notification_type: "seat_available",
        sent_at: daysAgo(10),
        is_active: false,
      },
    ]);

    // Clerk confirmed only expiredUser's identity gone (and recentUser's, which is still inside its window).
    const purged = await purgeExpiredData(db, [`clerk_${expiredUser}`, `clerk_${recentUser}`]);

    expect(purged.accountsPurged).toBeGreaterThanOrEqual(2);
    expect(purged.notificationsPurged).toBeGreaterThanOrEqual(1);
    expect(purged.classStatesPurged).toBeGreaterThanOrEqual(1);

    const remainingUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, [expiredUser, unconfirmedUser, legacyUser, recentUser, activeUser]));

    // An unconfirmed account keeps the row that maps it to its Clerk id for the next run.
    expect(remainingUsers.map((u) => u.id).sort()).toEqual(
      [activeUser, recentUser, unconfirmedUser].sort(),
    );

    const orphanedProfiles = await db
      .select({ id: userProfiles.user_id })
      .from(userProfiles)
      .where(eq(userProfiles.user_id, expiredUser));

    expect(orphanedProfiles).toEqual([]);

    const remainingNotifications = await db
      .select({ sent_at: notificationsSent.sent_at })
      .from(notificationsSent)
      .where(eq(notificationsSent.class_watch_id, watch.id));

    expect(remainingNotifications).toHaveLength(1);

    const remainingStates = await db
      .select({ class_nbr: classStates.class_nbr })
      .from(classStates)
      .where(eq(classStates.term, term));

    expect(remainingStates.map((s) => s.class_nbr).sort()).toEqual(
      [watched.class_nbr, unwatchedFresh.class_nbr].sort(),
    );
  });
});
