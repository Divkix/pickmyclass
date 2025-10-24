/**
 * Cloudflare Workers KV Cache Utilities
 *
 * Provides caching layer for class states and notification flags.
 * PostgreSQL remains the source of truth - KV is used for performance.
 */

import { getServiceClient } from '@/lib/supabase/service'

/**
 * Class state structure matching database schema
 */
export interface ClassState {
  term: string
  subject: string
  catalog_nbr: string
  class_nbr: string
  title: string
  instructor_name: string
  seats_available: number
  seats_capacity: number
  location?: string
  meeting_times?: string
  last_checked_at: string
  last_changed_at?: string
}

/**
 * KV key prefixes for namespacing
 */
const KV_KEYS = {
  CLASS_STATE: (class_nbr: string) => `class_state:${class_nbr}`,
  NOTIFICATION: (watch_id: string, type: string) => `notif:${watch_id}:${type}`,
} as const

/**
 * Default TTLs (in seconds)
 */
const TTL = {
  CLASS_STATE: 3600, // 1 hour (matches cron frequency)
  NOTIFICATION: 86400, // 24 hours (matches notification reset policy)
} as const

/**
 * Get class state from KV cache
 * Falls back to PostgreSQL if not in cache and populates cache
 *
 * @param kv - KV namespace binding
 * @param class_nbr - Section number
 * @returns Class state or null if not found
 */
export async function getClassState(
  kv: KVNamespace | undefined,
  class_nbr: string
): Promise<ClassState | null> {
  // If KV not available, fall back to PostgreSQL
  if (!kv) {
    console.log('[KV] KV namespace not available, falling back to PostgreSQL')
    return getClassStateFromDB(class_nbr)
  }

  try {
    // Try KV first
    const cached = await kv.get<ClassState>(KV_KEYS.CLASS_STATE(class_nbr), 'json')

    if (cached) {
      console.log(`[KV] Cache HIT for class_state:${class_nbr}`)
      return cached
    }

    console.log(`[KV] Cache MISS for class_state:${class_nbr}`)

    // On cache miss, fetch from PostgreSQL and populate cache
    const state = await getClassStateFromDB(class_nbr)
    if (state) {
      await setClassState(kv, class_nbr, state)
    }

    return state
  } catch (error) {
    console.error('[KV] Error reading from KV, falling back to PostgreSQL:', error)
    return getClassStateFromDB(class_nbr)
  }
}

/**
 * Set class state in KV cache
 * Should be called after writing to PostgreSQL to keep in sync
 *
 * @param kv - KV namespace binding
 * @param class_nbr - Section number
 * @param state - Class state data
 */
export async function setClassState(
  kv: KVNamespace | undefined,
  class_nbr: string,
  state: ClassState
): Promise<void> {
  if (!kv) {
    console.log('[KV] KV namespace not available, skipping cache write')
    return
  }

  try {
    await kv.put(KV_KEYS.CLASS_STATE(class_nbr), JSON.stringify(state), {
      expirationTtl: TTL.CLASS_STATE,
    })
    console.log(`[KV] Cached class_state:${class_nbr} (TTL: ${TTL.CLASS_STATE}s)`)
  } catch (error) {
    console.error('[KV] Error writing to KV:', error)
    // Don't throw - cache write failures shouldn't break the flow
  }
}

/**
 * Delete class state from KV cache
 * Use when removing a class watch to clean up
 *
 * @param kv - KV namespace binding
 * @param class_nbr - Section number
 */
export async function deleteClassState(
  kv: KVNamespace | undefined,
  class_nbr: string
): Promise<void> {
  if (!kv) return

  try {
    await kv.delete(KV_KEYS.CLASS_STATE(class_nbr))
    console.log(`[KV] Deleted class_state:${class_nbr}`)
  } catch (error) {
    console.error('[KV] Error deleting from KV:', error)
  }
}

/**
 * Check if a notification has been sent (KV-first)
 * Falls back to PostgreSQL if KV unavailable
 *
 * @param kv - KV namespace binding
 * @param watch_id - Class watch ID
 * @param type - Notification type
 * @returns True if notification was already sent
 */
export async function hasNotificationBeenSentKV(
  kv: KVNamespace | undefined,
  watch_id: string,
  type: 'seat_available' | 'instructor_assigned'
): Promise<boolean> {
  if (!kv) {
    console.log('[KV] KV namespace not available, falling back to PostgreSQL')
    return hasNotificationBeenSentDB(watch_id, type)
  }

  try {
    const key = KV_KEYS.NOTIFICATION(watch_id, type)
    const value = await kv.get(key)
    const sent = value === 'sent'

    console.log(`[KV] Notification check ${key}: ${sent ? 'SENT' : 'NOT SENT'}`)
    return sent
  } catch (error) {
    console.error('[KV] Error checking notification in KV, falling back to PostgreSQL:', error)
    return hasNotificationBeenSentDB(watch_id, type)
  }
}

/**
 * Record that a notification has been sent
 * Writes to both KV and PostgreSQL for durability
 *
 * @param kv - KV namespace binding
 * @param watch_id - Class watch ID
 * @param type - Notification type
 */
export async function recordNotificationSentKV(
  kv: KVNamespace | undefined,
  watch_id: string,
  type: 'seat_available' | 'instructor_assigned'
): Promise<void> {
  // Always write to PostgreSQL (source of truth)
  await recordNotificationSentDB(watch_id, type)

  // Also write to KV for fast lookups
  if (!kv) {
    console.log('[KV] KV namespace not available, skipping cache write')
    return
  }

  try {
    const key = KV_KEYS.NOTIFICATION(watch_id, type)
    await kv.put(key, 'sent', {
      expirationTtl: TTL.NOTIFICATION,
    })
    console.log(`[KV] Recorded notification ${key} (TTL: ${TTL.NOTIFICATION}s)`)
  } catch (error) {
    console.error('[KV] Error recording notification in KV:', error)
    // Don't throw - PostgreSQL write succeeded, KV is just cache
  }
}

/**
 * Reset notifications for a specific class section
 * Clears both KV cache and PostgreSQL records
 *
 * @param kv - KV namespace binding
 * @param class_nbr - Section number
 * @param type - Notification type to reset
 */
export async function resetNotificationsKV(
  kv: KVNamespace | undefined,
  class_nbr: string,
  type: 'seat_available' | 'instructor_assigned'
): Promise<void> {
  // Reset in PostgreSQL first
  const watchIds = await resetNotificationsDB(class_nbr, type)

  // Clear KV cache for all affected watches
  if (kv && watchIds.length > 0) {
    try {
      const deletePromises = watchIds.map((watch_id) =>
        kv.delete(KV_KEYS.NOTIFICATION(watch_id, type))
      )
      await Promise.all(deletePromises)
      console.log(`[KV] Cleared ${watchIds.length} notification flags for ${class_nbr}`)
    } catch (error) {
      console.error('[KV] Error clearing notification flags:', error)
      // Don't throw - PostgreSQL reset succeeded
    }
  }
}

// ----- PostgreSQL Fallback Functions -----

/**
 * Fetch class state from PostgreSQL
 */
async function getClassStateFromDB(class_nbr: string): Promise<ClassState | null> {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('class_states')
    .select('*')
    .eq('class_nbr', class_nbr)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found
      return null
    }
    console.error('[DB] Error fetching class state:', error)
    return null
  }

  return data as ClassState
}

/**
 * Check if notification was sent (PostgreSQL)
 */
async function hasNotificationBeenSentDB(
  watch_id: string,
  type: 'seat_available' | 'instructor_assigned'
): Promise<boolean> {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('notifications_sent')
    .select('id')
    .eq('class_watch_id', watch_id)
    .eq('notification_type', type)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (error && error.code !== 'PGRST116') {
    console.error('[DB] Error checking notification:', error)
    return false
  }

  return !!data
}

/**
 * Record notification sent (PostgreSQL)
 */
async function recordNotificationSentDB(
  watch_id: string,
  type: 'seat_available' | 'instructor_assigned'
): Promise<void> {
  const supabase = getServiceClient()

  const expiresAt = new Date()
  expiresAt.setHours(expiresAt.getHours() + 24)

  const { error } = await supabase.from('notifications_sent').insert({
    class_watch_id: watch_id,
    notification_type: type,
    expires_at: expiresAt.toISOString(),
  })

  if (error && error.code !== '23505') {
    // Ignore duplicate key errors
    console.error('[DB] Error recording notification:', error)
    throw new Error(`Failed to record notification: ${error.message}`)
  }
}

/**
 * Reset notifications in PostgreSQL
 * Returns watch IDs that were affected
 */
async function resetNotificationsDB(
  class_nbr: string,
  type: 'seat_available' | 'instructor_assigned'
): Promise<string[]> {
  const supabase = getServiceClient()

  // Get all watch IDs for this section
  const { data: watches, error: watchError } = await supabase
    .from('class_watches')
    .select('id')
    .eq('class_nbr', class_nbr)

  if (watchError || !watches) {
    console.error('[DB] Error fetching watches for reset:', watchError)
    return []
  }

  const watchIds = watches.map((w) => w.id)

  if (watchIds.length === 0) {
    return []
  }

  // Delete notification records
  const { error: deleteError } = await supabase
    .from('notifications_sent')
    .delete()
    .in('class_watch_id', watchIds)
    .eq('notification_type', type)

  if (deleteError) {
    console.error('[DB] Error resetting notifications:', deleteError)
    throw new Error(`Failed to reset notifications: ${deleteError.message}`)
  }

  console.log(`[DB] Reset ${type} notifications for ${watchIds.length} watchers`)
  return watchIds
}
