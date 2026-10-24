import { and, count, eq, exists, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/lib/db";
import { driverErrorMessage } from "@/lib/db/pg-errors";
import { classStates, classWatches } from "@/lib/db/schema";
import { errorFields, log } from "@/lib/log";
import { type SectionRef, sectionFields } from "@/lib/section-ref";
import type { ClassDetails } from "@/lib/types/class";
import type { ClassStateRow } from "@/lib/types/class-watch";
import type { NotificationType } from "@/lib/types/notification";
import type { StaggerGroup } from "@/lib/types/stagger";

export interface EligibleWatcherRpcRow {
  user_id: string;
  email: string;
  watch_id: string;
}

export interface ClassWatcher extends EligibleWatcherRpcRow {
  created_at?: string;
}

type DriverTimestamp = string | Date | null | undefined;

function normalizeIsoTimestamp(value: DriverTimestamp): string | undefined {
  if (value === null || value === undefined) return undefined;

  const date =
    value instanceof Date
      ? value
      : new Date(
          String(value)
            .replace(" ", "T")
            .replace(/([+-]\d{2})$/, "$1:00"),
        );

  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

const incrementCountSchema = z.number();

async function incrementConsecutiveNotFoundViaRpc(db: Database, ref: SectionRef): Promise<number> {
  // The RPC creates the placeholder row itself when the section has never been
  // seen, so this is one atomic statement with no insert-fallback race.
  const { rows } = await db.execute<{ new_count: unknown }>(
    sql`SELECT public.increment_consecutive_not_found(${ref.class_nbr}::text, ${ref.term}::text) AS new_count`,
  );

  const newCount = rows[0]?.new_count;
  const parsedCount = incrementCountSchema.safeParse(newCount);

  if (!parsedCount.success) {
    throw new Error(`Invalid increment result: ${String(newCount)}`);
  }

  return parsedCount.data;
}

export async function getClassWatchers(db: Database, ref: SectionRef): Promise<ClassWatcher[]> {
  try {
    const { rows } = await db.execute<{
      user_id: string;
      email: string;
      watch_id: string;
      created_at: DriverTimestamp;
    }>(sql`SELECT user_id, email, watch_id, created_at
        FROM public.get_class_watchers(${ref.class_nbr}::text, ${ref.term}::text)`);

    return rows.map((row) => ({
      user_id: row.user_id,
      email: row.email,
      watch_id: row.watch_id,
      created_at: normalizeIsoTimestamp(row.created_at),
    }));
  } catch (error) {
    log("DB").error("Error fetching watchers", { ...sectionFields(ref), ...errorFields(error) });
    throw new Error(`Failed to fetch watchers: ${driverErrorMessage(error)}`);
  }
}

export async function getNotificationWatchers(
  db: Database,
  ref: SectionRef,
): Promise<EligibleWatcherRpcRow[]> {
  try {
    // Compose the text[] server-side from a separately-bound scalar.
    const { rows } = await db.execute<{
      user_id: string;
      email: string;
      watch_id: string;
    }>(sql`SELECT user_id, email, watch_id
        FROM public.get_watchers_for_sections(ARRAY[${ref.class_nbr}::text], ${ref.term}::text)`);

    return rows.map((row) => ({
      user_id: row.user_id,
      email: row.email,
      watch_id: row.watch_id,
    }));
  } catch (error) {
    log("DB").error("Error fetching notification watchers", {
      ...sectionFields(ref),
      ...errorFields(error),
    });
    throw new Error(`Failed to fetch notification watchers: ${driverErrorMessage(error)}`);
  }
}

export async function getSectionsToCheck(
  db: Database,
  staggerType: StaggerGroup = "all",
): Promise<SectionRef[]> {
  try {
    const { rows } = await db.execute<{ class_nbr: string; term: string }>(
      sql`SELECT class_nbr, term FROM public.get_sections_to_check(${staggerType}::text)`,
    );

    log("DB").info("Found sections to check", {
      sections: rows.length,
      stagger_group: staggerType,
    });

    return rows.map((row) => ({ class_nbr: row.class_nbr, term: row.term }));
  } catch (error) {
    log("DB").error("Error fetching sections to check", errorFields(error));
    throw new Error(`Failed to fetch sections: ${driverErrorMessage(error)}`);
  }
}

/** Select expression: has this class_states row's alert cutoff passed? False for unknown dates. */
export const sectionAlertsEnded = sql<boolean>`public.section_alerts_ended(${classStates.start_date}, ${classStates.end_date})`;

/**
 * class_states rows for this user's watched sections among `classNumbers`. The
 * EXISTS keeps the query user-scoped so one user never reads another's state row.
 */
export async function getWatchedClassStates(
  db: Database,
  userId: string,
  classNumbers: string[],
): Promise<ClassStateRow[]> {
  if (classNumbers.length === 0) return [];

  const ownership = exists(
    db
      .select({ one: sql`1` })
      .from(classWatches)
      .where(
        and(
          eq(classWatches.user_id, userId),
          eq(classWatches.class_nbr, classStates.class_nbr),
          eq(classWatches.term, classStates.term),
        ),
      ),
  );

  return db
    .select({
      id: classStates.id,
      class_nbr: classStates.class_nbr,
      term: classStates.term,
      subject: classStates.subject,
      catalog_nbr: classStates.catalog_nbr,
      title: classStates.title,
      instructor_name: classStates.instructor_name,
      seats_available: classStates.seats_available,
      seats_capacity: classStates.seats_capacity,
      non_reserved_seats: classStates.non_reserved_seats,
      location: classStates.location,
      meeting_times: classStates.meeting_times,
      last_checked_at: classStates.last_checked_at,
      last_changed_at: classStates.last_changed_at,
      consecutive_not_found_count: classStates.consecutive_not_found_count,
      start_date: classStates.start_date,
      end_date: classStates.end_date,
      session_code: classStates.session_code,
      alerts_ended: sectionAlertsEnded,
    })
    .from(classStates)
    .where(and(inArray(classStates.class_nbr, classNumbers), ownership));
}

const alertsEndedSchema = z.object({ ended: z.boolean() });

/** Whether a fresh ASU observation is already past its alert cutoff. */
export async function readSectionAlertsEnded(
  db: Database,
  details: ClassDetails,
): Promise<boolean> {
  // Unknown dates never end alerts, so skip the round trip.
  if (!details.start_date || !details.end_date) return false;

  try {
    const { rows } = await db.execute<{ ended: unknown }>(
      sql`SELECT public.section_alerts_ended(${details.start_date}::date, ${details.end_date}::date) AS ended`,
    );

    return alertsEndedSchema.parse(rows[0]).ended;
  } catch (error) {
    throw new Error(`Failed to read section alert cutoff: ${driverErrorMessage(error)}`);
  }
}

export async function getMostWatchedClass(db: Database, term: string): Promise<SectionRef | null> {
  try {
    const { rows } = await db.execute<{ class_nbr: string; term: string }>(
      sql`SELECT class_nbr, term FROM public.get_most_watched_class(${term}::text)`,
    );

    const row = rows[0];

    if (!row) return null;

    return { class_nbr: row.class_nbr, term: row.term };
  } catch (error) {
    log("DB").error("Error fetching most watched class", { term, ...errorFields(error) });
    throw new Error(`Failed to fetch most watched class: ${driverErrorMessage(error)}`);
  }
}

export async function resetNotificationsForSection(
  db: Database,
  ref: SectionRef,
  notificationType: NotificationType = "seat_available",
): Promise<void> {
  try {
    // Single join-scoped DELETE: a SELECT-then-DELETE by watch id list can outlive a
    // watch row that moved out of the section and delete a foreign active claim.
    const { rows } = await db.execute<{ deleted: unknown }>(
      sql`SELECT public.reset_section_notifications(${ref.class_nbr}::text, ${ref.term}::text, ${notificationType}::text) AS deleted`,
    );

    const deleted = Number(rows[0]?.deleted ?? 0);
    log("DB").info("Reset section notifications", {
      ...sectionFields(ref),
      notification_type: notificationType,
      deleted,
    });
  } catch (error) {
    log("DB").error("Error resetting notifications", {
      ...sectionFields(ref),
      ...errorFields(error),
    });
    throw new Error(`Failed to reset notifications: ${driverErrorMessage(error)}`);
  }
}

export async function deleteNotificationRecords(
  db: Database,
  watchIds: string[],
  notificationType: NotificationType,
): Promise<number> {
  if (watchIds.length === 0) return 0;

  try {
    // Compose the uuid[] server-side from separately-bound scalars;
    // watchIds is guarded non-empty above.
    const idParams = watchIds.map((id) => sql`${id}::uuid`);

    const { rows } = await db.execute<{ deleted: unknown }>(
      sql`SELECT public.delete_notification_records(ARRAY[${sql.join(idParams, sql`, `)}], ${notificationType}::text) AS deleted`,
    );

    const deleted = Number(rows[0]?.deleted ?? 0);
    log("DB").info("Deleted notification records", { deleted, watches: watchIds.length });

    return deleted;
  } catch (error) {
    log("DB").error("Error deleting notification records", errorFields(error));
    throw new Error(`Failed to delete notification records: ${driverErrorMessage(error)}`);
  }
}

export async function deleteNotificationRecordsByIds(
  db: Database,
  notificationIds: string[],
): Promise<number> {
  if (notificationIds.length === 0) return 0;

  try {
    // Compose the uuid[] server-side from separately-bound scalars
    // (notificationIds guarded non-empty above).
    const idParams = notificationIds.map((id) => sql`${id}::uuid`);

    const { rows } = await db.execute<{ deleted: unknown }>(
      sql`SELECT public.delete_notification_records_by_ids(ARRAY[${sql.join(idParams, sql`, `)}]) AS deleted`,
    );

    const deleted = Number(rows[0]?.deleted ?? 0);
    log("DB").info("Deleted notification records by id", {
      deleted,
      notification_count: notificationIds.length,
    });

    return deleted;
  } catch (error) {
    log("DB").error("Error deleting notification records by id", errorFields(error));
    throw new Error(`Failed to delete notification records by id: ${driverErrorMessage(error)}`);
  }
}

export async function deletePastTermWatches(db: Database, termCodes: string[]): Promise<number> {
  if (termCodes.length === 0) return 0;

  try {
    const deleted = await db
      .delete(classWatches)
      .where(inArray(classWatches.term, termCodes))
      .returning({ id: classWatches.id });

    log("DB").info("Deleted past-term watches", {
      watches_deleted: deleted.length,
      terms: termCodes.length,
    });

    return deleted.length;
  } catch (error) {
    log("DB").error("Error deleting past-term watches", errorFields(error));
    throw new Error(`Failed to delete past-term watches: ${driverErrorMessage(error)}`);
  }
}

export type ClaimedNotification = {
  notificationId: string;
  watchId: string;
};

const claimedNotificationSchema = z.object({
  notification_id: z.string().min(1),
  class_watch_id: z.string().min(1),
});

export async function tryRecordNotificationsBatch(
  db: Database,
  watchIds: string[],
  notificationType: NotificationType,
  expiresHours: number = 24,
): Promise<ClaimedNotification[]> {
  if (watchIds.length === 0) return [];

  try {
    // The uuid[] is composed server-side. The function returns one row per
    // new claim so the notification id is known at insert time.
    const idParams = watchIds.map((id) => sql`${id}::uuid`);

    const { rows } = await db.execute<{
      notification_id: unknown;
      class_watch_id: unknown;
    }>(sql`SELECT notification_id, class_watch_id
        FROM public.try_record_notifications_batch(ARRAY[${sql.join(idParams, sql`, `)}], ${notificationType}::text, ${expiresHours}::integer)`);

    // The RPC already committed these claims, so a malformed row must fail the
    // batch instead of silently dropping a recipient's email.
    const claimed = rows.map((row) => {
      const parsed = claimedNotificationSchema.parse(row);

      return { notificationId: parsed.notification_id, watchId: parsed.class_watch_id };
    });

    log("DB").info("Claimed notifications", {
      notification_type: notificationType,
      claimed: claimed.length,
      watches: watchIds.length,
    });

    return claimed;
  } catch (error) {
    log("DB").error("Error claiming notifications", {
      notification_type: notificationType,
      ...errorFields(error),
    });
    throw new Error(`Failed to batch record notifications: ${driverErrorMessage(error)}`);
  }
}

const upsertAppliedSchema = z.object({ applied: z.boolean() });

export async function upsertClassState(
  db: Database,
  ref: SectionRef,
  details: ClassDetails,
  observedAt: Date,
): Promise<boolean> {
  let rows: Array<{ applied: unknown }>;

  try {
    // RPC, not a drizzle upsert: the write takes a SectionRef advisory lock
    // and applies only when observedAt is at least last_checked_at, so a
    // slower check cannot clobber a newer observation or its strike count.
    ({ rows } = await db.execute<{ applied: unknown }>(
      sql`SELECT public.upsert_class_state_locked(
      ${ref.class_nbr}::text,
      ${ref.term}::text,
      ${details.subject}::text,
      ${details.catalog_nbr}::text,
      ${details.title}::text,
      ${details.instructor_name || null}::text,
      ${details.seats_available || 0}::integer,
      ${details.seats_capacity || 0}::integer,
      ${details.non_reserved_seats ?? null}::integer,
      ${details.location || null}::text,
      ${details.meeting_times || null}::text,
      ${observedAt.toISOString()}::timestamptz
    ) AS applied`,
    ));
  } catch (error) {
    throw new Error(`Failed to upsert class state: ${driverErrorMessage(error)}`);
  }

  const parsed = upsertAppliedSchema.safeParse(rows[0]);

  if (!parsed.success) {
    throw new Error(`Invalid upsert result: ${String(rows[0]?.applied)}`);
  }

  return parsed.data.applied;
}

export async function insertClassStateIfMissing(
  db: Database,
  ref: SectionRef,
  details: ClassDetails,
): Promise<void> {
  try {
    await db
      .insert(classStates)
      .values({
        class_nbr: ref.class_nbr,
        term: ref.term,
        subject: details.subject,
        catalog_nbr: details.catalog_nbr,
        title: details.title,
        instructor_name: details.instructor_name || null,
        seats_available: details.seats_available || 0,
        seats_capacity: details.seats_capacity || 0,
        non_reserved_seats: details.non_reserved_seats ?? null,
        location: details.location || null,
        meeting_times: details.meeting_times || null,
        start_date: details.start_date,
        end_date: details.end_date,
        session_code: details.session_code,
        last_checked_at: new Date().toISOString(),
        consecutive_not_found_count: 0,
      })
      // Seed only: an existing row is pipeline state (and carries a strike
      // counter), so a watch creation must never overwrite it.
      .onConflictDoNothing({ target: [classStates.class_nbr, classStates.term] });
  } catch (error) {
    throw new Error(`Failed to insert class state: ${driverErrorMessage(error)}`);
  }
}

export async function incrementConsecutiveNotFound(db: Database, ref: SectionRef): Promise<number> {
  try {
    const newCount = await incrementConsecutiveNotFoundViaRpc(db, ref);
    log("DB").info("Incremented consecutive_not_found_count", {
      ...sectionFields(ref),
      strike_count: newCount,
    });

    return newCount;
  } catch (error) {
    log("DB").error("Error incrementing consecutive_not_found_count", {
      ...sectionFields(ref),
      ...errorFields(error),
    });
    throw new Error(
      `Failed to increment consecutive_not_found_count: ${driverErrorMessage(error)}`,
    );
  }
}

export async function deleteSectionAndWatches(
  db: Database,
  ref: SectionRef,
): Promise<{ watchesDeleted: number; stateDeleted: boolean }> {
  try {
    const result = await db.transaction(async (tx) => {
      const deletedWatches = await tx
        .delete(classWatches)
        .where(and(eq(classWatches.class_nbr, ref.class_nbr), eq(classWatches.term, ref.term)))
        .returning({ id: classWatches.id });

      const deletedState = await tx
        .delete(classStates)
        .where(and(eq(classStates.class_nbr, ref.class_nbr), eq(classStates.term, ref.term)))
        .returning({ id: classStates.id });

      return {
        watchesDeleted: deletedWatches.length,
        stateDeleted: deletedState.length > 0,
      };
    });

    log("DB").info("Deleted section and watches", {
      ...sectionFields(ref),
      watches_deleted: result.watchesDeleted,
      state_deleted: result.stateDeleted,
    });

    return result;
  } catch (error) {
    log("DB").error("Error deleting section and watches", {
      ...sectionFields(ref),
      ...errorFields(error),
    });
    throw new Error(`Failed to delete section: ${driverErrorMessage(error)}`);
  }
}

export type SectionRemovalClassInfo = {
  subject: string | null;
  catalog_nbr: string | null;
  title: string | null;
};

export async function readAutoCleanupBreakerCounts(db: Database): Promise<{
  total: number;
  flagged: number;
}> {
  try {
    const [totalRows, flaggedRows] = await Promise.all([
      db.select({ value: count() }).from(classStates),
      db
        .select({ value: count() })
        .from(classStates)
        .where(gte(classStates.consecutive_not_found_count, 1)),
    ]);

    return {
      total: Number(totalRows[0]?.value ?? 0),
      flagged: Number(flaggedRows[0]?.value ?? 0),
    };
  } catch (error) {
    log("DB").error("Error reading auto-cleanup breaker counts", errorFields(error));
    throw new Error(`Failed to read auto-cleanup breaker counts: ${driverErrorMessage(error)}`);
  }
}

export async function capConsecutiveNotFound(
  db: Database,
  ref: SectionRef,
  maxCount: number,
): Promise<void> {
  try {
    await db
      .update(classStates)
      .set({ consecutive_not_found_count: maxCount })
      .where(
        and(
          eq(classStates.class_nbr, ref.class_nbr),
          eq(classStates.term, ref.term),
          ne(classStates.consecutive_not_found_count, maxCount),
        ),
      );
    log("DB").info("Capped consecutive_not_found_count", {
      ...sectionFields(ref),
      max_count: maxCount,
    });
  } catch (error) {
    log("DB").error("Error capping consecutive_not_found_count", {
      ...sectionFields(ref),
      ...errorFields(error),
    });
    throw new Error(`Failed to cap consecutive_not_found_count: ${driverErrorMessage(error)}`);
  }
}

export async function readSectionRemovalClassInfo(
  db: Database,
  ref: SectionRef,
): Promise<SectionRemovalClassInfo | null> {
  try {
    const rows = await db
      .select({
        subject: classStates.subject,
        catalog_nbr: classStates.catalog_nbr,
        title: classStates.title,
      })
      .from(classStates)
      .where(and(eq(classStates.class_nbr, ref.class_nbr), eq(classStates.term, ref.term)))
      .limit(1);

    return rows[0] ?? null;
  } catch (error) {
    log("DB").error("Error fetching removal class info", {
      ...sectionFields(ref),
      ...errorFields(error),
    });
    throw new Error(`Failed to fetch removal class info: ${driverErrorMessage(error)}`);
  }
}

export type SectionCheckState = {
  class_nbr: string;
  term: string;
  seats_available: number;
  non_reserved_seats: number | null;
  instructor_name: string | null;
  consecutive_not_found_count: number;
  /** ISO-8601 UTC, or undefined when the driver returns no timestamp. */
  last_checked_at?: string;
  /** A pending notification intent (live or expired) exists for this SectionRef. */
  has_pending_intent: boolean;
};

export async function readSectionCheckState(
  db: Database,
  ref: SectionRef,
): Promise<SectionCheckState | null> {
  try {
    const rows = await db
      .select({
        class_nbr: classStates.class_nbr,
        term: classStates.term,
        seats_available: classStates.seats_available,
        non_reserved_seats: classStates.non_reserved_seats,
        instructor_name: classStates.instructor_name,
        consecutive_not_found_count: classStates.consecutive_not_found_count,
        last_checked_at: classStates.last_checked_at,
        // Intents reference class_states, so no row also means no intent.
        has_pending_intent: sql<boolean>`EXISTS (SELECT 1 FROM public.pending_section_notifications
          WHERE class_nbr = ${ref.class_nbr} AND term = ${ref.term})`,
      })
      .from(classStates)
      .where(and(eq(classStates.class_nbr, ref.class_nbr), eq(classStates.term, ref.term)))
      .limit(1);

    const row = rows[0];

    if (!row) return null;

    return { ...row, last_checked_at: normalizeIsoTimestamp(row.last_checked_at) };
  } catch (error) {
    log("DB").error("Error fetching section check state", {
      ...sectionFields(ref),
      ...errorFields(error),
    });
    throw new Error(`Failed to fetch section check state: ${driverErrorMessage(error)}`);
  }
}

const purgedSchema = z.object({
  accounts_purged: z.number(),
  notifications_purged: z.number(),
  class_states_purged: z.number(),
});

export type PurgedData = {
  accountsPurged: number;
  notificationsPurged: number;
  classStatesPurged: number;
};

/** Deletes data past the privacy policy's retention windows (see migration 0012). */
export async function purgeExpiredData(db: Database): Promise<PurgedData> {
  try {
    const { rows } = await db.execute(sql`SELECT * FROM public.purge_expired_data()`);
    const purged = purgedSchema.parse(rows[0]);

    return {
      accountsPurged: purged.accounts_purged,
      notificationsPurged: purged.notifications_purged,
      classStatesPurged: purged.class_states_purged,
    };
  } catch (error) {
    log("DB").error("Error purging expired data", errorFields(error));
    throw new Error(`Failed to purge expired data: ${driverErrorMessage(error)}`);
  }
}
