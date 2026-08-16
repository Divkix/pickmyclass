import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from '@/lib/log';
import { applySectionRef, type SectionRef } from '@/lib/section-ref';
import type { Database } from '@/lib/supabase/database.types';
import type { ClassDetails } from '@/lib/types/class';
import type { NotificationType } from '@/lib/types/notification';
import type { StaggerGroup } from '@/lib/types/stagger';
import { getServiceClient } from '@/lib/supabase/service';

/**
 * User watching a class section
 */
export interface ClassWatcher {
  user_id: string;
  email: string;
  watch_id: string;
  created_at?: string; // Optional for backward compatibility
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
  const supabase = getServiceClient();

  // Call PostgreSQL function that joins class_watches with auth.users
  // SECURITY DEFINER allows accessing auth.users from service role context
  const { data, error } = await supabase.rpc('get_class_watchers', {
    p_class_nbr: ref.class_nbr,
    p_term: ref.term,
  });

  if (error) {
    log('DB').error(
      `Error fetching watchers for section ${ref.class_nbr} (term ${ref.term}):`,
      error
    );
    throw new Error(`Failed to fetch watchers: ${error.message}`);
  }

  return data || [];
}

/**
 * Get sections to check based on stagger type (even/odd)
 * Uses server-side filtering for optimal performance
 *
 * @param staggerType - 'even', 'odd', or 'all'
 * @returns Array of unique sections to check
 */
export async function getSectionsToCheck(staggerType: StaggerGroup = 'all'): Promise<SectionRef[]> {
  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc('get_sections_to_check', {
    stagger_type: staggerType,
  });

  if (error) {
    log('DB').error(`Error fetching sections to check:`, error);
    throw new Error(`Failed to fetch sections: ${error.message}`);
  }

  log('DB').info(`Found ${data?.length || 0} sections to check (stagger: ${staggerType})`);

  return data || [];
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
  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc('get_most_watched_class', { p_term: term });

  if (error) {
    log('DB').error(`Error fetching most watched class for term ${term}:`, error);
    throw new Error(`Failed to fetch most watched class: ${error.message}`);
  }

  // SAFETY: get_most_watched_class RPC returns SectionRef rows; narrow generic Json array at boundary
  const row = (data as SectionRef[] | null)?.[0];
  if (!row) return null;
  return { class_nbr: row.class_nbr, term: row.term };
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
  const supabase = getServiceClient();

  const { data: watches, error: watchError } = await applySectionRef(
    supabase.from('class_watches').select('id'),
    ref
  );

  if (watchError) {
    log('DB').error(`Error fetching watches for reset:`, watchError);
    throw new Error(`Failed to fetch watches: ${watchError.message}`);
  }

  if (!watches || watches.length === 0) {
    log('DB').info(`No watches found for section ${ref.class_nbr}, nothing to reset`);
    return;
  }

  const watchIds = watches.map((w) => w.id);

  const { error: deleteError } = await supabase
    .from('notifications_sent')
    .delete()
    .in('class_watch_id', watchIds)
    .eq('notification_type', notificationType);

  if (deleteError) {
    log('DB').error('Error resetting notifications:', deleteError);
    throw new Error(`Failed to reset notifications: ${deleteError.message}`);
  }

  log('DB').info(
    `Reset ${notificationType} notifications for ${watchIds.length} watchers of section ${ref.class_nbr}`
  );
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
  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc('delete_notification_records', {
    p_class_watch_ids: watchIds,
    p_notification_type: notificationType,
  });

  if (error) {
    log('DB').error('Error deleting notification records:', error);
    throw new Error(`Failed to delete notification records: ${error.message}`);
  }

  log('DB').info(`Deleted ${data} notification records for ${watchIds.length} watches`);
  return data;
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
  const supabase = getServiceClient();

  const { count, error } = await supabase
    .from('class_watches')
    .delete({ count: 'exact' })
    .in('term', termCodes);

  if (error) {
    log('DB').error('Error deleting past-term watches:', error);
    throw new Error(`Failed to delete past-term watches: ${error.message}`);
  }

  log('DB').info(`Deleted ${count ?? 0} past-term watches for ${termCodes.length} terms`);
  return count ?? 0;
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
  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc('try_record_notifications_batch', {
    p_class_watch_ids: watchIds,
    p_notification_type: notificationType,
    p_expires_hours: expiresHours,
  });

  if (error) {
    log('DB').error('Error in batch notification check:', error);
    throw new Error(`Failed to batch record notifications: ${error.message}`);
  }

  // SAFETY: try_record_notifications_batch RPC returns text[] of recorded watch IDs per contract
  const recordedIds = new Set<string>(data as string[]);
  log('DB').info(`Batch ${notificationType}: ${recordedIds.size}/${watchIds.length} recorded`);
  return recordedIds;
}

/**
 * Upsert class state from fetched ASU API data.
 * Used by both class-watches POST and fetch-class-details POST.
 *
 * @param serviceClient - Supabase service-role client
 * @param ref - SectionRef identifying the section ({ class_nbr, term })
 * @param details - Class details from the ASU API
 */
export async function upsertClassState(
  serviceClient: SupabaseClient<Database>,
  ref: SectionRef,
  details: ClassDetails
): Promise<void> {
  const { class_nbr, term } = ref;
  const { error } = await serviceClient.from('class_states').upsert(
    {
      term,
      subject: details.subject,
      catalog_nbr: details.catalog_nbr,
      class_nbr,
      title: details.title,
      instructor_name: details.instructor_name || null,
      seats_available: details.seats_available || 0,
      seats_capacity: details.seats_capacity || 0,
      non_reserved_seats: details.non_reserved_seats ?? null,
      location: details.location || null,
      meeting_times: details.meeting_times || null,
      last_checked_at: new Date().toISOString(),
    },
    { onConflict: 'class_nbr,term' }
  );

  if (error) {
    throw new Error(`Failed to upsert class state: ${error.message}`);
  }
}
