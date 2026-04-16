/**
 * Database Query Helpers
 *
 * Reusable database queries for common operations.
 */

import { getServiceClient } from '@/lib/supabase/service';

/**
 * User watching a class section
 */
export interface ClassWatcher {
  user_id: string;
  email: string;
  watch_id: string;
  created_at?: string; // Optional for backward compatibility
  class_nbr?: string; // Added for bulk fetching
}

/**
 * Get all users watching a specific class section
 *
 * @param classNbr - Section number (e.g., "12431")
 * @returns Array of watchers with email addresses and creation timestamps
 */
export async function getClassWatchers(classNbr: string): Promise<ClassWatcher[]> {
  const supabase = getServiceClient();

  // Call PostgreSQL function that joins class_watches with auth.users
  // SECURITY DEFINER allows accessing auth.users from service role context
  const { data, error } = await supabase.rpc('get_class_watchers', {
    section_number: classNbr,
  });

  if (error) {
    console.error(`[DB] Error fetching watchers for section ${classNbr}:`, error);
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
export async function getSectionsToCheck(
  staggerType: 'even' | 'odd' | 'all' = 'all'
): Promise<Array<{ class_nbr: string; term: string }>> {
  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc('get_sections_to_check', {
    stagger_type: staggerType,
  });

  if (error) {
    console.error(`[DB] Error fetching sections to check:`, error);
    throw new Error(`Failed to fetch sections: ${error.message}`);
  }

  console.log(`[DB] Found ${data?.length || 0} sections to check (stagger: ${staggerType})`);

  return data || [];
}

/**
 * Reset seat_available notifications for a specific class section
 * Called when seats fill back to zero, allowing users to be re-notified
 * when seats open again.
 *
 * @param classNbr - Section number (e.g., "12431")
 * @param notificationType - Type of notification to reset (default: 'seat_available')
 */
export async function resetNotificationsForSection(
  classNbr: string,
  notificationType: 'seat_available' | 'instructor_assigned' = 'seat_available'
): Promise<void> {
  const supabase = getServiceClient();

  const { data: watches, error: watchError } = await supabase
    .from('class_watches')
    .select('id')
    .eq('class_nbr', classNbr);

  if (watchError) {
    console.error(`[DB] Error fetching watches for reset:`, watchError);
    throw new Error(`Failed to fetch watches: ${watchError.message}`);
  }

  if (!watches || watches.length === 0) {
    console.log(`[DB] No watches found for section ${classNbr}, nothing to reset`);
    return;
  }

  const watchIds = watches.map((w) => w.id);

  const { error: deleteError } = await supabase
    .from('notifications_sent')
    .delete()
    .in('class_watch_id', watchIds)
    .eq('notification_type', notificationType);

  if (deleteError) {
    console.error('[DB] Error resetting notifications:', deleteError);
    throw new Error(`Failed to reset notifications: ${deleteError.message}`);
  }

  console.log(
    `[DB] Reset ${notificationType} notifications for ${watchIds.length} watchers of section ${classNbr}`
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
  notificationType: 'seat_available' | 'instructor_assigned'
): Promise<number> {
  if (watchIds.length === 0) return 0;
  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc('delete_notification_records', {
    p_class_watch_ids: watchIds,
    p_notification_type: notificationType,
  });

  if (error) {
    console.error('[DB] Error deleting notification records:', error);
    throw new Error(`Failed to delete notification records: ${error.message}`);
  }

  console.log(`[DB] Deleted ${data} notification records for ${watchIds.length} watches`);
  return data;
}

/**
 * Batch check-and-record notifications atomically.
 * Returns the set of watch IDs that were successfully recorded (safe to send email).
 *
 * @param watchIds - Array of class watch UUIDs to check
 * @param notificationType - Type of notification
 * @param expiresHours - Hours until notification expires (default: 24)
 * @returns Set of watch IDs that were recorded (not previously sent)
 */
export async function tryRecordNotificationsBatch(
  watchIds: string[],
  notificationType: 'seat_available' | 'instructor_assigned',
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
    console.error('[DB] Error in batch notification check:', error);
    throw new Error(`Failed to batch record notifications: ${error.message}`);
  }

  const recordedIds = new Set<string>(data as string[]);
  console.log(`[DB] Batch ${notificationType}: ${recordedIds.size}/${watchIds.length} recorded`);
  return recordedIds;
}
