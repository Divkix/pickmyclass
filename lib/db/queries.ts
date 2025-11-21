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
  created_at?: string // Optional for backward compatibility
  class_nbr?: string // Added for bulk fetching
}

/**
 * Get all users watching a specific class section
 *
 * @param classNbr - Section number (e.g., "12431")
 * @returns Array of watchers with email addresses and creation timestamps
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
 * Get all users watching multiple class sections (bulk operation)
 * Eliminates N+1 query pattern by fetching watchers for all sections in one query
 *
 * @param classNumbers - Array of section numbers (e.g., ["12431", "12432"])
 * @returns Map of section number to array of watchers
 */
export async function getBulkClassWatchers(
  classNumbers: string[]
): Promise<Map<string, ClassWatcher[]>> {
  const supabase = getServiceClient()

  if (classNumbers.length === 0) {
    return new Map()
  }

  // Call PostgreSQL function that bulk fetches watchers for multiple sections
  const { data, error } = await supabase.rpc('get_watchers_for_sections', {
    section_numbers: classNumbers,
  })

  if (error) {
    console.error(`[DB] Error bulk fetching watchers:`, error)
    throw new Error(`Failed to bulk fetch watchers: ${error.message}`)
  }

  // Group watchers by section number
  const watcherMap = new Map<string, ClassWatcher[]>()

  for (const watcher of data || []) {
    const { class_nbr, ...watcherData } = watcher
    if (!watcherMap.has(class_nbr)) {
      watcherMap.set(class_nbr, [])
    }
    watcherMap.get(class_nbr)!.push(watcherData)
  }

  console.log(
    `[DB] Bulk fetched watchers for ${classNumbers.length} sections (total: ${data?.length || 0} watchers)`
  )

  return watcherMap
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
  const supabase = getServiceClient()

  const { data, error } = await supabase.rpc('get_sections_to_check', {
    stagger_type: staggerType,
  })

  if (error) {
    console.error(`[DB] Error fetching sections to check:`, error)
    throw new Error(`Failed to fetch sections: ${error.message}`)
  }

  console.log(`[DB] Found ${data?.length || 0} sections to check (stagger: ${staggerType})`)

  return data || []
}

/**
 * Atomically check and record notification in one operation
 * Eliminates race condition in parallel queue processing
 *
 * @param watchId - Class watch ID
 * @param notificationType - Type of notification ('seat_available' | 'instructor_assigned')
 * @param expiresHours - Hours until notification expires (default: 24, max: 168)
 * @returns True if notification was recorded (safe to send email), false if already exists (skip)
 *
 * @example
 * // CORRECT: Check atomically BEFORE sending email
 * const shouldSend = await tryRecordNotification(watchId, 'seat_available')
 * if (shouldSend) {
 *   await sendEmail(...)
 * }
 *
 * @example
 * // WRONG: Check-then-send pattern (race condition!)
 * const alreadySent = await hasNotificationBeenSent(watchId, 'seat_available')
 * if (!alreadySent) {
 *   await sendEmail(...)
 *   await recordNotificationSent(watchId, 'seat_available')
 * }
 */
export async function tryRecordNotification(
  watchId: string,
  notificationType: 'seat_available' | 'instructor_assigned',
  expiresHours: number = 24
): Promise<boolean> {
  const supabase = getServiceClient()

  const { data, error } = await supabase.rpc('try_record_notification', {
    p_class_watch_id: watchId,
    p_notification_type: notificationType,
    p_expires_hours: expiresHours,
  })

  if (error) {
    console.error('[DB] Error in atomic notification check:', error)
    throw new Error(`Failed to record notification: ${error.message}`)
  }

  const wasRecorded = data === true

  if (wasRecorded) {
    console.log(
      `[DB] ✅ Recorded ${notificationType} notification for watch ${watchId} (expires in ${expiresHours}h)`
    )
  } else {
    console.log(
      `[DB] ⏭️  Skipped ${notificationType} notification for watch ${watchId} (already sent)`
    )
  }

  return wasRecorded
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
