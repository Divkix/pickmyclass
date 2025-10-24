/**
 * Database Query Helpers
 *
 * Reusable database queries for common operations.
 */

import { getServiceClient } from '@/lib/supabase/service'

/**
 * User watching a class section
 */
export interface ClassWatcher {
  user_id: string
  email: string
  watch_id: string
}

/**
 * Get all users watching a specific class section
 *
 * @param classNbr - Section number (e.g., "12431")
 * @returns Array of watchers with email addresses
 */
export async function getClassWatchers(classNbr: string): Promise<ClassWatcher[]> {
  const supabase = getServiceClient()

  // Call PostgreSQL function that joins class_watches with auth.users
  // SECURITY DEFINER allows accessing auth.users from service role context
  const { data, error } = await supabase.rpc('get_class_watchers', {
    section_number: classNbr,
  })

  if (error) {
    console.error(`[DB] Error fetching watchers for section ${classNbr}:`, error)
    throw new Error(`Failed to fetch watchers: ${error.message}`)
  }

  return data || []
}

/**
 * Check if a notification has already been sent for a class watch
 * Now respects expiration timestamps - expired notifications are ignored
 *
 * @param watchId - Class watch ID
 * @param notificationType - Type of notification ('seat_available' | 'instructor_assigned')
 * @returns True if notification was already sent AND not expired
 */
export async function hasNotificationBeenSent(
  watchId: string,
  notificationType: 'seat_available' | 'instructor_assigned'
): Promise<boolean> {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('notifications_sent')
    .select('id')
    .eq('class_watch_id', watchId)
    .eq('notification_type', notificationType)
    .gt('expires_at', new Date().toISOString()) // Only check non-expired notifications
    .single()

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = not found (expected)
    console.error('[DB] Error checking notification status:', error)
    return false
  }

  return !!data
}

/**
 * Record that a notification has been sent
 * Sets expiration to 24 hours from now
 *
 * @param watchId - Class watch ID
 * @param notificationType - Type of notification ('seat_available' | 'instructor_assigned')
 */
export async function recordNotificationSent(
  watchId: string,
  notificationType: 'seat_available' | 'instructor_assigned'
): Promise<void> {
  const supabase = getServiceClient()

  const expiresAt = new Date()
  expiresAt.setHours(expiresAt.getHours() + 24) // 24 hours from now

  const { error } = await supabase.from('notifications_sent').insert({
    class_watch_id: watchId,
    notification_type: notificationType,
    expires_at: expiresAt.toISOString(),
  })

  if (error) {
    // Ignore duplicate key errors (constraint violation)
    if (error.code === '23505') {
      console.log(
        `[DB] Notification already recorded for watch ${watchId} (${notificationType})`
      )
      return
    }

    console.error('[DB] Error recording notification:', error)
    throw new Error(`Failed to record notification: ${error.message}`)
  }

  console.log(
    `[DB] Recorded ${notificationType} notification for watch ${watchId} (expires: ${expiresAt.toISOString()})`
  )
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
  const supabase = getServiceClient()

  // Get all watch IDs for this section
  const { data: watches, error: watchError } = await supabase
    .from('class_watches')
    .select('id')
    .eq('class_nbr', classNbr)

  if (watchError) {
    console.error(`[DB] Error fetching watches for reset:`, watchError)
    throw new Error(`Failed to fetch watches: ${watchError.message}`)
  }

  if (!watches || watches.length === 0) {
    console.log(`[DB] No watches found for section ${classNbr}, nothing to reset`)
    return
  }

  const watchIds = watches.map((w) => w.id)

  // Delete notification records for all watchers of this section
  const { error: deleteError } = await supabase
    .from('notifications_sent')
    .delete()
    .in('class_watch_id', watchIds)
    .eq('notification_type', notificationType)

  if (deleteError) {
    console.error('[DB] Error resetting notifications:', deleteError)
    throw new Error(`Failed to reset notifications: ${deleteError.message}`)
  }

  console.log(
    `[DB] Reset ${notificationType} notifications for ${watchIds.length} watchers of section ${classNbr}`
  )
}
