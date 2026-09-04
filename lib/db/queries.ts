import { and, count, eq, gte, inArray, ne, sql } from 'drizzle-orm';

import type { Database } from '@/lib/db';
import { driverErrorMessage, isUniqueViolation } from '@/lib/db/pg-errors';
import { classStates, classWatches, notificationsSent } from '@/lib/db/schema';
import { log } from '@/lib/log';
import type { SectionRef } from '@/lib/section-ref';
import type { ClassDetails } from '@/lib/types/class';
import type { NotificationType } from '@/lib/types/notification';
import type { StaggerGroup } from '@/lib/types/stagger';

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
            .replace(' ', 'T')
            .replace(/([+-]\d{2})$/, '$1:00')
        );
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

type DriverStringArray = readonly string[] | string;

function normalizeStringArray(value: DriverStringArray | null | undefined): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1);
    return inner.length === 0 ? [] : inner.split(',');
  }
  return [];
}

async function incrementConsecutiveNotFoundViaRpc(db: Database, ref: SectionRef): Promise<number> {
  const rows = await db.execute<{ new_count: unknown }>(
    sql`SELECT public.increment_consecutive_not_found(${ref.class_nbr}::text, ${ref.term}::text) AS new_count`
  );
  const newCount = rows[0]?.new_count;
  if (typeof newCount !== 'number' || !Number.isFinite(newCount)) {
    throw new Error(`Invalid increment result: ${String(newCount)}`);
  }
  return newCount;
}

export async function getClassWatchers(db: Database, ref: SectionRef): Promise<ClassWatcher[]> {
  try {
    const rows = await db.execute<{
      user_id: string;
      email: string;
      watch_id: string;
      created_at: DriverTimestamp;
    }>(
      sql`SELECT user_id, email, watch_id, created_at
          FROM public.get_class_watchers(${ref.class_nbr}::text, ${ref.term}::text)`
    );
    return rows.map((row) => ({
      user_id: row.user_id,
      email: row.email,
      watch_id: row.watch_id,
      created_at: normalizeIsoTimestamp(row.created_at),
    }));
  } catch (error) {
    log('DB').error(
      `Error fetching watchers for section ${ref.class_nbr} (term ${ref.term}):`,
      error
    );
    throw new Error(`Failed to fetch watchers: ${driverErrorMessage(error)}`);
  }
}

export async function getNotificationWatchers(
  db: Database,
  ref: SectionRef
): Promise<EligibleWatcherRpcRow[]> {
  try {
    // Array-bound RPC: neither drizzle's db.execute nor the native postgres-js
    // template can serialize a JS array under this driver config
    // (fetch_types: false registers no array serializers — live-proven
    // 22P02 'malformed array literal'). Compose the single-element array
    // server-side from separately-bound scalars instead.
    const rows = await db.execute<{
      user_id: string;
      email: string;
      watch_id: string;
    }>(
      sql`SELECT user_id, email, watch_id
          FROM public.get_watchers_for_sections(ARRAY[${ref.class_nbr}::text], ${ref.term}::text)`
    );
    return rows.map((row) => ({
      user_id: row.user_id,
      email: row.email,
      watch_id: row.watch_id,
    }));
  } catch (error) {
    log('DB').error(
      `Error fetching notification watchers for section ${ref.class_nbr} (term ${ref.term}):`,
      error
    );
    throw new Error(`Failed to fetch notification watchers: ${driverErrorMessage(error)}`);
  }
}

export async function getSectionsToCheck(
  db: Database,
  staggerType: StaggerGroup = 'all'
): Promise<SectionRef[]> {
  try {
    const rows = await db.execute<{ class_nbr: string; term: string }>(
      sql`SELECT class_nbr, term FROM public.get_sections_to_check(${staggerType}::text)`
    );
    log('DB').info(`Found ${rows.length} sections to check (stagger: ${staggerType})`);
    return rows.map((row) => ({ class_nbr: row.class_nbr, term: row.term }));
  } catch (error) {
    log('DB').error(`Error fetching sections to check:`, error);
    throw new Error(`Failed to fetch sections: ${driverErrorMessage(error)}`);
  }
}

export async function getMostWatchedClass(db: Database, term: string): Promise<SectionRef | null> {
  try {
    const rows = await db.execute<{ class_nbr: string; term: string }>(
      sql`SELECT class_nbr, term FROM public.get_most_watched_class(${term}::text)`
    );
    const row = rows[0];
    if (!row) return null;
    return { class_nbr: row.class_nbr, term: row.term };
  } catch (error) {
    log('DB').error(`Error fetching most watched class for term ${term}:`, error);
    throw new Error(`Failed to fetch most watched class: ${driverErrorMessage(error)}`);
  }
}

export async function resetNotificationsForSection(
  db: Database,
  ref: SectionRef,
  notificationType: NotificationType = 'seat_available'
): Promise<void> {
  try {
    const watches = await db
      .select({ id: classWatches.id })
      .from(classWatches)
      .where(and(eq(classWatches.class_nbr, ref.class_nbr), eq(classWatches.term, ref.term)));

    if (watches.length === 0) {
      log('DB').info(`No watches found for section ${ref.class_nbr}, nothing to reset`);
      return;
    }

    const deleted = await db
      .delete(notificationsSent)
      .where(
        and(
          inArray(
            notificationsSent.class_watch_id,
            watches.map((watch) => watch.id)
          ),
          eq(notificationsSent.notification_type, notificationType)
        )
      )
      .returning({ id: notificationsSent.id });

    log('DB').info(
      `Reset ${notificationType} notifications for ${watches.length} watchers of section ${ref.class_nbr} (${deleted.length} records deleted)`
    );
  } catch (error) {
    log('DB').error('Error resetting notifications:', error);
    throw new Error(`Failed to reset notifications: ${driverErrorMessage(error)}`);
  }
}

export async function deleteNotificationRecords(
  db: Database,
  watchIds: string[],
  notificationType: NotificationType
): Promise<number> {
  if (watchIds.length === 0) return 0;
  try {
    // Array-bound RPC: JS-array binds are unserializable under this driver
    // config (live-proven 22P02 through both drizzle and the native
    // postgres-js template). Compose the array server-side from
    // separately-bound scalars; watchIds is guarded non-empty above.
    const idParams = watchIds.map((id) => sql`${id}::uuid`);
    const rows = await db.execute<{ deleted: unknown }>(
      sql`SELECT public.delete_notification_records(ARRAY[${sql.join(idParams, sql`, `)}], ${notificationType}::text) AS deleted`
    );
    const deleted = Number(rows[0]?.deleted ?? 0);
    log('DB').info(`Deleted ${deleted} notification records for ${watchIds.length} watches`);
    return deleted;
  } catch (error) {
    log('DB').error('Error deleting notification records:', error);
    throw new Error(`Failed to delete notification records: ${driverErrorMessage(error)}`);
  }
}

export async function deletePastTermWatches(db: Database, termCodes: string[]): Promise<number> {
  if (termCodes.length === 0) return 0;
  try {
    const deleted = await db
      .delete(classWatches)
      .where(inArray(classWatches.term, termCodes))
      .returning({ id: classWatches.id });
    log('DB').info(`Deleted ${deleted.length} past-term watches for ${termCodes.length} terms`);
    return deleted.length;
  } catch (error) {
    log('DB').error('Error deleting past-term watches:', error);
    throw new Error(`Failed to delete past-term watches: ${driverErrorMessage(error)}`);
  }
}

export async function tryRecordNotificationsBatch(
  db: Database,
  watchIds: string[],
  notificationType: NotificationType,
  expiresHours: number = 24
): Promise<Set<string>> {
  if (watchIds.length === 0) return new Set();
  try {
    // Array-bound both ways: uuid[] in, claimed uuid[] out. JS-array binds
    // are unserializable under this driver config (live-proven 22P02), so the
    // input array composes server-side from separately-bound scalars
    // (watchIds guarded non-empty above) while the returned uuid[] column
    // normalizes through normalizeStringArray below.
    const idParams = watchIds.map((id) => sql`${id}::uuid`);
    const rows = await db.execute<{ recorded: DriverStringArray | null }>(
      sql`SELECT public.try_record_notifications_batch(ARRAY[${sql.join(idParams, sql`, `)}], ${notificationType}::text, ${expiresHours}::integer) AS recorded`
    );
    const recordedIds = new Set(normalizeStringArray(rows[0]?.recorded));
    log('DB').info(`Batch ${notificationType}: ${recordedIds.size}/${watchIds.length} recorded`);
    return recordedIds;
  } catch (error) {
    log('DB').error('Error in batch notification check:', error);
    throw new Error(`Failed to batch record notifications: ${driverErrorMessage(error)}`);
  }
}

export async function upsertClassState(
  db: Database,
  ref: SectionRef,
  details: ClassDetails
): Promise<void> {
  const now = new Date().toISOString();

  try {
    const row = {
      subject: details.subject,
      catalog_nbr: details.catalog_nbr,
      title: details.title,
      instructor_name: details.instructor_name || null,
      seats_available: details.seats_available || 0,
      seats_capacity: details.seats_capacity || 0,
      non_reserved_seats: details.non_reserved_seats ?? null,
      location: details.location || null,
      meeting_times: details.meeting_times || null,
      last_checked_at: now,
      consecutive_not_found_count: 0,
    };
    await db
      .insert(classStates)
      .values({
        class_nbr: ref.class_nbr,
        term: ref.term,
        ...row,
      })
      .onConflictDoUpdate({
        target: [classStates.class_nbr, classStates.term],
        set: { ...row },
      });
  } catch (error) {
    throw new Error(`Failed to upsert class state: ${driverErrorMessage(error)}`);
  }
}

export async function incrementConsecutiveNotFound(db: Database, ref: SectionRef): Promise<number> {
  try {
    const newCount = await incrementConsecutiveNotFoundViaRpc(db, ref);
    log('DB').info(
      `Incremented consecutive_not_found_count to ${newCount} for ${ref.class_nbr} (term ${ref.term}) via atomic RPC`
    );
    return newCount;
  } catch (error) {
    const message = driverErrorMessage(error);
    if (!message.includes('Section not found')) {
      log('DB').error('Error incrementing consecutive_not_found_count:', error);
      throw new Error(`Failed to increment consecutive_not_found_count: ${message}`);
    }

    try {
      await db.insert(classStates).values({
        class_nbr: ref.class_nbr,
        term: ref.term,
        subject: '',
        catalog_nbr: '',
        title: null,
        instructor_name: null,
        seats_available: 0,
        seats_capacity: 0,
        non_reserved_seats: null,
        location: null,
        meeting_times: null,
        last_checked_at: new Date().toISOString(),
        consecutive_not_found_count: 1,
      });
      log('DB').info(
        `Initialized consecutive_not_found_count=1 for ${ref.class_nbr} (term ${ref.term})`
      );
      return 1;
    } catch (insertError) {
      if (!isUniqueViolation(insertError)) {
        log('DB').error('Error inserting consecutive_not_found_count:', insertError);
        throw new Error(
          `Failed to increment consecutive_not_found_count: ${driverErrorMessage(insertError)}`
        );
      }

      try {
        const racedCount = await incrementConsecutiveNotFoundViaRpc(db, ref);
        log('DB').info(
          `Incremented consecutive_not_found_count to ${racedCount} for ${ref.class_nbr} (term ${ref.term}) after race via atomic RPC (recovered from insert 23505: ${driverErrorMessage(insertError)})`
        );
        return racedCount;
      } catch (racedError) {
        log('DB').error('Error incrementing consecutive_not_found_count after race:', racedError);
        throw new Error(
          `Failed to increment consecutive_not_found_count: ${driverErrorMessage(racedError)}`
        );
      }
    }
  }
}

export async function deleteSectionAndWatches(
  db: Database,
  ref: SectionRef
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

    log('DB').info(
      `Deleted ${result.watchesDeleted} watches and ${result.stateDeleted ? 1 : 0} state row for ${ref.class_nbr} (term ${ref.term})`
    );

    return result;
  } catch (error) {
    log('DB').error('Error deleting section and watches:', error);
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
    log('DB').error('Error reading auto-cleanup breaker counts:', error);
    throw new Error(`Failed to read auto-cleanup breaker counts: ${driverErrorMessage(error)}`);
  }
}

export async function capConsecutiveNotFound(
  db: Database,
  ref: SectionRef,
  maxCount: number
): Promise<void> {
  try {
    await db
      .update(classStates)
      .set({ consecutive_not_found_count: maxCount })
      .where(
        and(
          eq(classStates.class_nbr, ref.class_nbr),
          eq(classStates.term, ref.term),
          ne(classStates.consecutive_not_found_count, maxCount)
        )
      );
    log('DB').info(
      `Capped consecutive_not_found_count at ${maxCount} for ${ref.class_nbr} (term ${ref.term})`
    );
  } catch (error) {
    log('DB').error(
      `Error capping consecutive_not_found_count for ${ref.class_nbr} (term ${ref.term}):`,
      error
    );
    throw new Error(`Failed to cap consecutive_not_found_count: ${driverErrorMessage(error)}`);
  }
}

export async function readSectionRemovalClassInfo(
  db: Database,
  ref: SectionRef
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
    log('DB').error(
      `Error fetching removal class info for ${ref.class_nbr} (term ${ref.term}):`,
      error
    );
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
};

export async function readSectionCheckState(
  db: Database,
  ref: SectionRef
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
      })
      .from(classStates)
      .where(and(eq(classStates.class_nbr, ref.class_nbr), eq(classStates.term, ref.term)))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    log('DB').error(
      `Error fetching section check state for ${ref.class_nbr} (term ${ref.term}):`,
      error
    );
    throw new Error(`Failed to fetch section check state: ${driverErrorMessage(error)}`);
  }
}
