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
 *
 * @param watchId - Class watch ID
 * @param notificationType - Type of notification ('seat_available' | 'instructor_assigned')
 * @returns True if notification was already sent
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
 *
 * @param watchId - Class watch ID
 * @param notificationType - Type of notification ('seat_available' | 'instructor_assigned')
 */
export async function recordNotificationSent(
  watchId: string,
  notificationType: 'seat_available' | 'instructor_assigned'
): Promise<void> {
  const supabase = getServiceClient()

  const { error } = await supabase.from('notifications_sent').insert({
    class_watch_id: watchId,
    notification_type: notificationType,
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

  console.log(`[DB] Recorded ${notificationType} notification for watch ${watchId}`)
}
