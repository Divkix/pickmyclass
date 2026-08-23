import { callFunction, callFunctionScalar, execute, getClient, query } from '@/lib/db/client';
import type {
  ClassStateInsert,
  ClassWatcherRpcRow,
  EligibleWatcherRpcRow,
  SectionRefRpcRow,
} from '@/lib/db/types';
import { log } from '@/lib/log';
import type { SectionRef } from '@/lib/section-ref';
import type { ClassDetails } from '@/lib/types/class';
import type { NotificationType } from '@/lib/types/notification';
import type { StaggerGroup } from '@/lib/types/stagger';

/**
 * User watching a class section
 */
export interface ClassWatcher extends EligibleWatcherRpcRow {
  created_at?: string;
}

/**
 * Get all users watching a specific Class Section.
 *
 * Scoped by the full SectionRef ({ class_nbr, term }) — a section number repeats
 * across terms, so filtering by class_nbr alone over-lists watchers from other
 * terms.
 *
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @returns Array of watchers with email addresses and creation timestamps
 */
export async function getClassWatchers(ref: SectionRef): Promise<ClassWatcher[]> {
  try {
    const rows = await callFunction<ClassWatcherRpcRow>('get_class_watchers', [
      ref.class_nbr,
      ref.term,
    ]);
    return rows.map((r) => ({
      user_id: r.user_id,
      email: r.email,
      watch_id: r.watch_id,
      created_at: r.created_at,
    }));
  } catch (error) {
    log('DB').error(
      `Error fetching watchers for section ${ref.class_nbr} (term ${ref.term}):`,
      error
    );
    throw new Error(`Failed to fetch watchers: ${error instanceof Error ? error.message : error}`);
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
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @returns Array of eligible watchers with email addresses and watch ids
 */
export async function getNotificationWatchers(ref: SectionRef): Promise<EligibleWatcherRpcRow[]> {
  try {
    return await callFunction<EligibleWatcherRpcRow>('get_watchers_for_sections', [
      [ref.class_nbr],
      ref.term,
    ]);
  } catch (error) {
    log('DB').error(
      `Error fetching notification watchers for section ${ref.class_nbr} (term ${ref.term}):`,
      error
    );
    throw new Error(
      `Failed to fetch notification watchers: ${error instanceof Error ? error.message : error}`
    );
  }
}

/**
 * Get sections to check based on stagger type (even/odd)
 * Uses server-side filtering for optimal performance
 *
 * @param staggerType - 'even', 'odd', or 'all'
 * @returns Array of unique sections to check
 */
export async function getSectionsToCheck(staggerType: StaggerGroup = 'all'): Promise<SectionRef[]> {
  try {
    const rows = await callFunction<SectionRefRpcRow>('get_sections_to_check', [staggerType]);
    log('DB').info(`Found ${rows.length} sections to check (stagger: ${staggerType})`);
    return rows.map((r) => ({ class_nbr: r.class_nbr, term: r.term }));
  } catch (error) {
    log('DB').error(`Error fetching sections to check:`, error);
    throw new Error(`Failed to fetch sections: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Get the most-watched Class Section for a term — the onboarding "popular class"
 * example. Counts only active watchers (the RPC applies the same eligibility
 * filters as `get_sections_to_check` / `get_watchers_for_sections`). Returns
 * `null` when no active watches exist for the term.
 *
 * @param term - selectable term code to look up
 */
export async function getMostWatchedClass(term: string): Promise<SectionRef | null> {
  try {
    const rows = await callFunction<SectionRefRpcRow>('get_most_watched_class', [term]);
    const row = rows[0];
    if (!row) return null;
    return { class_nbr: row.class_nbr, term: row.term };
  } catch (error) {
    log('DB').error(`Error fetching most watched class for term ${term}:`, error);
    throw new Error(
      `Failed to fetch most watched class: ${error instanceof Error ? error.message : error}`
    );
  }
}

/**
 * Reset seat_available notifications for a specific class section
 * Called when seats fill back to zero, allowing users to be re-notified
 * when seats open again.
 *
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @param notificationType - Type of notification to reset (default: 'seat_available')
 */
export async function resetNotificationsForSection(
  ref: SectionRef,
  notificationType: NotificationType = 'seat_available'
): Promise<void> {
  try {
    const watchIds = await query<{ id: string }>(
      'SELECT id FROM class_watches WHERE class_nbr = $1 AND term = $2',
      [ref.class_nbr, ref.term]
    );

    if (watchIds.length === 0) {
      log('DB').info(`No watches found for section ${ref.class_nbr}, nothing to reset`);
      return;
    }

    const ids = watchIds.map((w) => w.id);
    const deleted = await execute(
      `DELETE FROM notifications_sent
       WHERE class_watch_id = ANY($1::uuid[])
         AND notification_type = $2`,
      [ids, notificationType]
    );

    log('DB').info(
      `Reset ${notificationType} notifications for ${watchIds.length} watchers of section ${ref.class_nbr} (${deleted} records deleted)`
    );
  } catch (error) {
    log('DB').error('Error resetting notifications:', error);
    throw new Error(
      `Failed to reset notifications: ${error instanceof Error ? error.message : error}`
    );
  }
}

/**
 * Delete notification records for specific watch IDs and type.
 * Used to rollback notification records when email sending fails.
 *
 * @param watchIds - Array of class watch UUIDs
 * @param notificationType - Type of notification to delete
 * @returns Number of records deleted
 */
export async function deleteNotificationRecords(
  watchIds: string[],
  notificationType: NotificationType
): Promise<number> {
  if (watchIds.length === 0) return 0;
  try {
    const count = await callFunctionScalar<number>('delete_notification_records', [
      watchIds,
      notificationType,
    ]);
    const deleted = Number(count ?? 0);
    log('DB').info(`Deleted ${deleted} notification records for ${watchIds.length} watches`);
    return deleted;
  } catch (error) {
    log('DB').error('Error deleting notification records:', error);
    throw new Error(
      `Failed to delete notification records: ${error instanceof Error ? error.message : error}`
    );
  }
}

/**
 * Hard-delete all class watches for the given (ended) term codes.
 * The notifications_sent rows cascade via the class_watch_id FK (ON DELETE CASCADE).
 * Used by the daily sweep to clear watches a student left on a finished semester.
 *
 * @param termCodes - Term codes whose watches should be removed (e.g. from getPastTermCodes)
 * @returns Number of class_watches rows deleted
 */
export async function deletePastTermWatches(termCodes: string[]): Promise<number> {
  if (termCodes.length === 0) return 0;
  try {
    const deleted = await execute(
      'DELETE FROM class_watches WHERE term = ANY($1::text[]) RETURNING id',
      [termCodes]
    );
    log('DB').info(`Deleted ${deleted} past-term watches for ${termCodes.length} terms`);
    return deleted;
  } catch (error) {
    log('DB').error('Error deleting past-term watches:', error);
    throw new Error(
      `Failed to delete past-term watches: ${error instanceof Error ? error.message : error}`
    );
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
 * @param watchIds - Array of class watch UUIDs to check
 * @param notificationType - Type of notification
 * @param expiresHours - Hours until notification expires (default: 24)
 * @returns Set of watch IDs that were recorded (not previously sent)
 */
export async function tryRecordNotificationsBatch(
  watchIds: string[],
  notificationType: NotificationType,
  expiresHours: number = 24
): Promise<Set<string>> {
  if (watchIds.length === 0) return new Set();
  try {
    const rows = await callFunction<{ try_record_notifications_batch: string[] }>(
      'try_record_notifications_batch',
      [watchIds, notificationType, expiresHours]
    );
    // The function returns text[] — pg unwraps it as a column named after the function.
    const resultCol = rows[0]?.try_record_notifications_batch;
    const recordedIds = new Set<string>(Array.isArray(resultCol) ? resultCol : []);
    log('DB').info(`Batch ${notificationType}: ${recordedIds.size}/${watchIds.length} recorded`);
    return recordedIds;
  } catch (error) {
    log('DB').error('Error in batch notification check:', error);
    throw new Error(
      `Failed to batch record notifications: ${error instanceof Error ? error.message : error}`
    );
  }
}

/**
 * Upsert class state from fetched ASU API data.
 * Used by both class-watches POST and fetch-class-details POST.
 *
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @param details - Class details from the ASU API
 */
export async function upsertClassState(ref: SectionRef, details: ClassDetails): Promise<void> {
  const { class_nbr, term } = ref;
  const now = new Date().toISOString();

  try {
    await execute(
      `INSERT INTO class_states (
        class_nbr, term, subject, catalog_nbr, title, instructor_name,
        seats_available, seats_capacity, non_reserved_seats, location,
        meeting_times, last_checked_at, consecutive_not_found_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0)
      ON CONFLICT (class_nbr, term) DO UPDATE SET
        subject = EXCLUDED.subject,
        catalog_nbr = EXCLUDED.catalog_nbr,
        title = EXCLUDED.title,
        instructor_name = EXCLUDED.instructor_name,
        seats_available = EXCLUDED.seats_available,
        seats_capacity = EXCLUDED.seats_capacity,
        non_reserved_seats = EXCLUDED.non_reserved_seats,
        location = EXCLUDED.location,
        meeting_times = EXCLUDED.meeting_times,
        last_checked_at = EXCLUDED.last_checked_at,
        consecutive_not_found_count = 0`,
      [
        class_nbr,
        term,
        details.subject,
        details.catalog_nbr,
        details.title,
        details.instructor_name || null,
        details.seats_available || 0,
        details.seats_capacity || 0,
        details.non_reserved_seats ?? null,
        details.location || null,
        details.meeting_times || null,
        now,
      ]
    );
  } catch (error) {
    throw new Error(
      `Failed to upsert class state: ${error instanceof Error ? error.message : error}`
    );
  }
}

/**
 * Increments `class_states.consecutive_not_found_count` for a SectionRef.
 * SectionRef-scoped (class_nbr + term) — both columns are used in the WHERE clause.
 * If the row does not exist (first observation with no class_states), creates it with
 * count=1 via insert with minimal placeholder fields.
 *
 * Atomic via RPC `increment_consecutive_not_found` — prevents lost increments under
 * concurrent workers for same SectionRef (read-modify-write race).
 *
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @returns The new consecutive_not_found_count value
 */
export async function incrementConsecutiveNotFound(ref: SectionRef): Promise<number> {
  try {
    const count = await callFunctionScalar<number>('increment_consecutive_not_found', [
      ref.class_nbr,
      ref.term,
    ]);
    if (typeof count !== 'number' || !Number.isFinite(count)) {
      throw new Error(`Invalid increment result: ${String(count)}`);
    }
    log('DB').info(
      `Incremented consecutive_not_found_count to ${count} for ${ref.class_nbr} (term ${ref.term}) via atomic RPC`
    );
    return count;
  } catch (error) {
    // Handle "Section not found" — no existing row, need to insert with count=1 (first observation)
    // The RPC raises an exception with message containing 'Section not found' and code P0001
    const msg = error instanceof Error ? error.message : '';
    const isNotFound = typeof msg === 'string' && msg.includes('Section not found');

    if (isNotFound) {
      // No existing row — insert with count=1 (no ON CONFLICT so concurrent real row triggers 23505
      // and does not clobber subject/catalog/seats)
      const now = new Date().toISOString();
      const insertData: ClassStateInsert = {
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
        consecutive_not_found_count: 1,
        last_checked_at: now,
      };

      try {
        await execute(
          `INSERT INTO class_states (
            class_nbr, term, subject, catalog_nbr, title, instructor_name,
            seats_available, seats_capacity, non_reserved_seats, location,
            meeting_times, last_checked_at, consecutive_not_found_count
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            insertData.class_nbr,
            insertData.term,
            insertData.subject,
            insertData.catalog_nbr,
            insertData.title,
            insertData.instructor_name,
            insertData.seats_available,
            insertData.seats_capacity,
            insertData.non_reserved_seats,
            insertData.location,
            insertData.meeting_times,
            insertData.last_checked_at,
            insertData.consecutive_not_found_count,
          ]
        );
        log('DB').info(
          `Initialized consecutive_not_found_count=1 for ${ref.class_nbr} (term ${ref.term})`
        );
        return 1;
      } catch (insertError) {
        // Check for unique constraint violation (23505) — race: row was created concurrently
        const insertMsg = insertError instanceof Error ? insertError.message : '';
        // SAFETY: pg error has a code property for identifying constraint violations
        const pgError = insertError as { code?: string };
        if (pgError.code === '23505' || insertMsg.includes('23505')) {
          // Race: row was created concurrently — retry atomic increment via RPC
          try {
            const racedCount = await callFunctionScalar<number>('increment_consecutive_not_found', [
              ref.class_nbr,
              ref.term,
            ]);
            if (typeof racedCount !== 'number' || !Number.isFinite(racedCount)) {
              throw new Error(`Invalid increment result: ${String(racedCount)}`);
            }
            log('DB').info(
              `Incremented consecutive_not_found_count to ${racedCount} for ${ref.class_nbr} (term ${ref.term}) after race via atomic RPC (recovered from insert 23505: ${insertMsg})`
            );
            return racedCount;
          } catch (racedError) {
            log('DB').error(
              'Error incrementing consecutive_not_found_count after race:',
              racedError
            );
            throw new Error(
              `Failed to increment consecutive_not_found_count: ${racedError instanceof Error ? racedError.message : racedError}`
            );
          }
        }
        log('DB').error('Error inserting consecutive_not_found_count:', insertError);
        throw new Error(
          `Failed to increment consecutive_not_found_count: ${insertError instanceof Error ? insertError.message : insertError}`
        );
      }
    }

    log('DB').error('Error incrementing consecutive_not_found_count:', error);
    throw new Error(
      `Failed to increment consecutive_not_found_count: ${error instanceof Error ? error.message : error}`
    );
  }
}

/**
 * Hard-deletes all watches and state for a SectionRef.
 * Deletes `class_watches` rows first (cascades `notifications_sent` via FK),
 * then deletes the `class_states` row. SectionRef-scoped — both `class_nbr`
 * and `term` are used in the WHERE clause.
 *
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @returns Object with number of watches deleted and whether the state row was deleted
 */
export async function deleteSectionAndWatches(
  ref: SectionRef
): Promise<{ watchesDeleted: number; stateDeleted: boolean }> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const watchesResult = await client.query(
      'DELETE FROM class_watches WHERE class_nbr = $1 AND term = $2 RETURNING id',
      [ref.class_nbr, ref.term]
    );
    const watchesDeleted = watchesResult.rowCount ?? 0;

    const stateResult = await client.query(
      'DELETE FROM class_states WHERE class_nbr = $1 AND term = $2 RETURNING id',
      [ref.class_nbr, ref.term]
    );
    const stateDeleted = (stateResult.rowCount ?? 0) > 0;

    await client.query('COMMIT');

    log('DB').info(
      `Deleted ${watchesDeleted} watches and ${stateDeleted ? 1 : 0} state row for ${ref.class_nbr} (term ${ref.term})`
    );

    return { watchesDeleted, stateDeleted };
  } catch (error) {
    await client.query('ROLLBACK');
    log('DB').error('Error deleting section and watches:', error);
    throw new Error(`Failed to delete section: ${error instanceof Error ? error.message : error}`);
  } finally {
    client.release();
  }
}
