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

  // Join class_watches with auth.users to get email addresses
  // Use service_role client to bypass RLS and access auth.users
  const { data, error } = await supabase
    .from('class_watches')
    .select(
      `
      id,
      user_id,
      users:user_id (
        email
      )
    `
    )
    .eq('class_nbr', classNbr)

  if (error) {
    console.error(`[DB] Error fetching watchers for section ${classNbr}:`, error)
    throw new Error(`Failed to fetch watchers: ${error.message}`)
  }

  // Transform the result to flatten the structure
  const watchers: ClassWatcher[] = (data || [])
    .filter((watch) => watch.users && 'email' in watch.users)
    .map((watch) => ({
      user_id: watch.user_id,
      email: (watch.users as { email: string }).email,
      watch_id: watch.id,
    }))

  return watchers
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
