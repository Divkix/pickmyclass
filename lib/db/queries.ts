/**
 * Runtime query layer for the class-watch domain: watcher reads, section
 * state, and notification dedup.
 *
 * Every export takes the request-scoped Drizzle {@link Database} first — entry
 * points create one handle (see `lib/db/index`) and pass it down; this module
 * never touches a connection itself. Table CRUD uses Drizzle builders; the
 * SECURITY DEFINER PostgreSQL functions that encode product invariants
 * (watcher eligibility policy, atomic dedup claims, atomic counters) are
 * called through `db.execute` with bound parameters and explicit casts.
 *
 * @module lib/db/queries
 */
import { and, count, eq, gte, inArray, ne, sql } from 'drizzle-orm';

import type { Database } from '@/lib/db';
import { driverErrorMessage, isUniqueViolation } from '@/lib/db/pg-errors';
import { classStates, classWatches, notificationsSent } from '@/lib/db/schema';
import { log } from '@/lib/log';
import type { SectionRef } from '@/lib/section-ref';
import type { ClassDetails } from '@/lib/types/class';
import type { NotificationType } from '@/lib/types/notification';
import type { StaggerGroup } from '@/lib/types/stagger';

/**
 * Watcher fields shared by every recipient read: the watcher RPCs project
 * exactly these columns for notification sends.
 */
export interface EligibleWatcherRpcRow {
  user_id: string;
  email: string;
  watch_id: string;
}

/**
 * User watching a class section
 */
export interface ClassWatcher extends EligibleWatcherRpcRow {
  created_at?: string;
}

/**
 * Timestamp shapes the driver hands this boundary: raw PG timestamptz text
 * under the configured transparent parsers, a parsed Date if parsers change,
 * or SQL NULL.
 */
type DriverTimestamp = string | Date | null | undefined;

/**
 * Normalize a driver timestamp value to the ISO-8601 UTC string shape the
 * previous pg-based API exposed through JSON serialization. Drizzle configures
 * postgres-js with transparent parsers, so timestamptz arrives as raw PG text
 * ("2026-08-25 12:34:56.789+00") rather than a Date — convert once here at
 * the typed query boundary instead of in route callers.
 */
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

/**
 * uuid[]/text[] wire shapes at this boundary: a driver-parsed JS array, or
 * the raw '{…}' literal text when no array parser is registered
 * (fetch_types: false). UUIDs and section numbers never contain
 * commas or quotes, so brace-strip-and-split is lossless here.
 */
type DriverStringArray = readonly string[] | string;

function normalizeStringArray(value: DriverStringArray | null | undefined): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1);
    return inner.length === 0 ? [] : inner.split(',');
  }
  return [];
}

/**
 * Atomically increment `consecutive_not_found_count` via the SECURITY DEFINER
 * RPC. Raises SQLSTATE P0001 "Section not found" when no class_states row
 * exists yet.
 *
 * @returns The new consecutive_not_found_count value
 */
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

/**
 * Get all users watching a specific Class Section.
 *
 * Scoped by the full SectionRef ({ class_nbr, term }) — a section number repeats
 * across terms, so filtering by class_nbr alone over-lists watchers from other
 * terms.
 *
 * @param db - Request-scoped Drizzle database handle
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @returns Array of watchers with email addresses and creation timestamps
 */
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

/**
 * Get all eligible watchers for a section — the notification sender's read
 * path. Delegates to the `get_watchers_for_sections` RPC, which applies
 * eligibility filtering server-side.
 *
 * Scoped by the full SectionRef ({ class_nbr, term }) — a section number
 * repeats across terms, so filtering by class_nbr alone over-lists watchers
 * from other terms.
 *
 * @param db - Request-scoped Drizzle database handle
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @returns Array of eligible watchers with email addresses and watch ids
 */
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

/**
 * Get sections to check based on stagger type (even/odd)
 * Uses server-side filtering for optimal performance
 *
 * @param db - Request-scoped Drizzle database handle
 * @param staggerType - 'even', 'odd', or 'all'
 * @returns Array of unique sections to check
 */
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

/**
 * Get the most-watched Class Section for a term — the onboarding "popular class"
 * example. Counts only active watchers (the RPC applies the same eligibility
 * filters as `get_sections_to_check` / `get_watchers_for_sections`). Returns
 * `null` when no active watches exist for the term.
 *
 * @param db - Request-scoped Drizzle database handle
 * @param term - selectable term code to look up
 */
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

/**
 * Reset seat_available notifications for a specific class section
 * Called when seats fill back to zero, allowing users to be re-notified
 * when seats open again.
 *
 * @param db - Request-scoped Drizzle database handle
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @param notificationType - Type of notification to reset (default: 'seat_available')
 */
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

/**
 * Delete notification records for specific watch IDs and type.
 * Used to rollback notification records when email sending fails.
 *
 * @param db - Request-scoped Drizzle database handle
 * @param watchIds - Array of class watch UUIDs
 * @param notificationType - Type of notification to delete
 * @returns Number of records deleted
 */
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

/**
 * Hard-delete all class watches for the given (ended) term codes.
 * The notifications_sent rows cascade via the class_watch_id FK (ON DELETE CASCADE).
 * Used by the daily sweep to clear watches a student left on a finished semester.
 *
 * @param db - Request-scoped Drizzle database handle
 * @param termCodes - Term codes whose watches should be removed (e.g. from getPastTermCodes)
 * @returns Number of class_watches rows deleted
 */
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

/**
 * Batch check-and-record notifications atomically.
 * Returns the set of watch IDs that were successfully recorded (safe to send email).
 * Called *after* upsertClassState / direct upsert in the queue pipeline
 * (see process-section.ts Step 5 TRADEOFF comment) — the upsert-before-claim
 * ordering avoids double-send on retry at the cost of a small crash window
 * where a notification can be lost. Fail-open rollback handling in
 * notification-sender mitigates the window without adding a cross-table RPC.
 *
 * @param db - Request-scoped Drizzle database handle
 * @param watchIds - Array of class watch UUIDs to check
 * @param notificationType - Type of notification
 * @param expiresHours - Hours until notification expires (default: 24)
 * @returns Set of watch IDs that were recorded (not previously sent)
 */
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
    // The scalar UUID[] may arrive as a JS array or raw '{…}' wire text
    // depending on registered array parsers; normalize either shape.
    const recordedIds = new Set(normalizeStringArray(rows[0]?.recorded));
    log('DB').info(`Batch ${notificationType}: ${recordedIds.size}/${watchIds.length} recorded`);
    return recordedIds;
  } catch (error) {
    log('DB').error('Error in batch notification check:', error);
    throw new Error(`Failed to batch record notifications: ${driverErrorMessage(error)}`);
  }
}

/**
 * Upsert class state from fetched ASU API data.
 * Used by both class-watches POST and fetch-class-details POST.
 *
 * @param db - Request-scoped Drizzle database handle
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @param details - Class details from the ASU API
 */
export async function upsertClassState(
  db: Database,
  ref: SectionRef,
  details: ClassDetails
): Promise<void> {
  const now = new Date().toISOString();

  try {
    // last_changed_at is intentionally untouched on both paths: the column
    // default fills it on first insert and change detection owns it afterwards.
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
        last_checked_at: now,
        consecutive_not_found_count: 0,
      })
      .onConflictDoUpdate({
        target: [classStates.class_nbr, classStates.term],
        set: {
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
        },
      });
  } catch (error) {
    throw new Error(`Failed to upsert class state: ${driverErrorMessage(error)}`);
  }
}

/**
 * Increments `class_states.consecutive_not_found_count` for a SectionRef.
 * SectionRef-scoped (class_nbr + term). Atomic via RPC
 * `increment_consecutive_not_found` — prevents lost increments under
 * concurrent workers (read-modify-write race).
 *
 * If the row does not exist (first observation with no class_states), creates
 * it with count=1 via a plain insert with minimal placeholder fields. A 23505
 * on that insert means a concurrent worker created the real row mid-flight —
 * the atomic RPC is retried against the winner's row so no increment is lost.
 *
 * @param db - Request-scoped Drizzle database handle
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @returns The new consecutive_not_found_count value
 */
export async function incrementConsecutiveNotFound(db: Database, ref: SectionRef): Promise<number> {
  try {
    const newCount = await incrementConsecutiveNotFoundViaRpc(db, ref);
    log('DB').info(
      `Incremented consecutive_not_found_count to ${newCount} for ${ref.class_nbr} (term ${ref.term}) via atomic RPC`
    );
    return newCount;
  } catch (error) {
    // Handle "Section not found" — no existing row, insert with count=1 (first observation).
    // The RPC raises an exception whose message contains 'Section not found'.
    const message = driverErrorMessage(error);
    if (!message.includes('Section not found')) {
      log('DB').error('Error incrementing consecutive_not_found_count:', error);
      throw new Error(`Failed to increment consecutive_not_found_count: ${message}`);
    }

    // No existing row — plain insert (no ON CONFLICT) so a concurrent real row
    // triggers 23505 instead of clobbering subject/catalog/seats data.
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

      // Race: row was created concurrently — retry the atomic increment.
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

/**
 * Hard-deletes all watches and state for a SectionRef inside one transaction.
 * Deletes `class_watches` rows first (cascades `notifications_sent` via FK),
 * then deletes the `class_states` row. SectionRef-scoped — both `class_nbr`
 * and `term` are used in the WHERE clause.
 *
 * @param db - Request-scoped Drizzle database handle
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @returns Object with number of watches deleted and whether the state row was deleted
 */
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

/**
 * Class-info columns needed to compose auto-cleanup removal emails for a
 * retired section.
 */
export type SectionRemovalClassInfo = {
  subject: string | null;
  catalog_nbr: string | null;
  title: string | null;
};

/**
 * Reads both COUNT probes for the auto-cleanup circuit breaker: the total
 * number of class_states rows and the rows flagged with
 * `consecutive_not_found_count >= 1`. Returns raw counts only — ratio math
 * and suppression policy live with the caller.
 *
 * @param db - Request-scoped Drizzle database handle
 * @returns { total, flagged } as numbers; null scalars project to 0
 */
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

/**
 * Caps `class_states.consecutive_not_found_count` for a SectionRef while the
 * auto-cleanup breaker is tripped, so the threshold is not re-hit on every
 * subsequent cycle. The `consecutive_not_found_count != maxCount` guard skips
 * no-op writes when the count already sits at the cap.
 *
 * @param db - Request-scoped Drizzle database handle
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @param maxCount - Value to pin the counter to (threshold - 1)
 */
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

/**
 * Reads subject/catalog/title for a SectionRef to compose auto-cleanup
 * removal emails. Returns `null` when no class_states row exists (e.g. the
 * row was removed concurrently); throws translated DB errors — callers that
 * treat class info as optional degrade to null themselves.
 *
 * @param db - Request-scoped Drizzle database handle
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 */
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

/**
 * Old-state snapshot the Section Check pipeline compares fresh ASU API data
 * against. Projected columns only — the rest of the class_states row is
 * irrelevant to change detection.
 */
export type SectionCheckState = {
  class_nbr: string;
  term: string;
  seats_available: number;
  non_reserved_seats: number | null;
  instructor_name: string | null;
  consecutive_not_found_count: number;
};

/**
 * Reads the persisted class_states baseline for a SectionRef ahead of the ASU
 * API fetch in the Section Check pipeline. Returns `null` when no row exists —
 * a first observation, not an error. Throws translated DB errors so callers
 * reach their unknown-error retry disposition.
 *
 * @param db - Request-scoped Drizzle database handle
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 */
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
