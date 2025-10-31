/**
 * Admin-Specific Database Queries
 *
 * Reusable admin queries for dashboard metrics and user management.
 * All functions use service role client to bypass RLS.
 *
 * @module lib/db/admin-queries
 */

import { getServiceClient } from '@/lib/supabase/service'
import type { Tables } from '@/lib/supabase/database.types'

/**
 * Class state with aggregated watcher count
 */
export interface ClassWithWatchers extends Tables<'class_states'> {
  watcher_count: number
}

/**
 * User information with watch count
 */
export interface UserWithWatchCount {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  email_confirmed_at: string | null
  watch_count: number
}

/**
 * Class watch with joined class state information
 */
export interface WatchWithClass extends Tables<'class_watches'> {
  class_state: Tables<'class_states'> | null
}

/**
 * Get total number of emails sent
 *
 * Counts all rows in the notifications_sent table regardless of expiration.
 *
 * @returns Total count of notifications sent
 *
 * @example
 * const total = await getTotalEmailsSent()
 * console.log(`Total emails sent: ${total}`)
 */
export async function getTotalEmailsSent(): Promise<number> {
  const supabase = getServiceClient()

  const { count, error } = await supabase
    .from('notifications_sent')
    .select('*', { count: 'exact', head: true })

  if (error) {
    console.error('[Admin] Error fetching total emails sent:', error)
    throw new Error(`Failed to fetch email count: ${error.message}`)
  }

  return count || 0
}

/**
 * Get total number of registered users
 *
 * Queries auth.users table via admin API.
 *
 * @returns Total count of registered users
 *
 * @example
 * const total = await getTotalUsers()
 * console.log(`Total users: ${total}`)
 */
export async function getTotalUsers(): Promise<number> {
  const supabase = getServiceClient()

  try {
    const { data, error } = await supabase.auth.admin.listUsers()

    if (error) {
      console.error('[Admin] Error fetching total users:', error)
      throw new Error(`Failed to fetch user count: ${error.message}`)
    }

    return data?.users?.length || 0
  } catch (err) {
    console.error('[Admin] Exception fetching users:', err)
    throw err
  }
}

/**
 * Get total number of unique classes being watched
 *
 * Counts distinct class_nbr values in class_watches table.
 *
 * @returns Total count of unique classes
 *
 * @example
 * const total = await getTotalClassesWatched()
 * console.log(`Total classes watched: ${total}`)
 */
export async function getTotalClassesWatched(): Promise<number> {
  const supabase = getServiceClient()

  // Fetch all class_nbr values and count unique ones
  const { data: watches, error } = await supabase.from('class_watches').select('class_nbr')

  if (error) {
    console.error('[Admin] Error fetching total classes watched:', error)
    throw new Error(`Failed to fetch class count: ${error.message}`)
  }

  // Count unique class numbers
  const uniqueClasses = new Set(watches?.map((w) => w.class_nbr) || [])
  const count = uniqueClasses.size

  console.log(`[Admin] Counted ${count} unique classes being watched`)

  return count
}

/**
 * Get all classes with their watcher counts
 *
 * Joins class_states with aggregated class_watches to show which classes
 * are most popular. Sorted by watcher count descending.
 *
 * @returns Array of classes with watcher counts
 *
 * @example
 * const classes = await getAllClassesWithWatchers()
 * console.log(`Most watched: ${classes[0].title} (${classes[0].watcher_count} watchers)`)
 */
export async function getAllClassesWithWatchers(): Promise<ClassWithWatchers[]> {
  const supabase = getServiceClient()

  // Fetch all class states
  const { data: classStates, error: classError } = await supabase
    .from('class_states')
    .select('*')
    .order('class_nbr', { ascending: true })

  if (classError) {
    console.error('[Admin] Error fetching class states:', classError)
    throw new Error(`Failed to fetch classes: ${classError.message}`)
  }

  // Fetch all class watches
  const { data: watches, error: watchError } = await supabase
    .from('class_watches')
    .select('class_nbr')

  if (watchError) {
    console.error('[Admin] Error fetching class watches:', watchError)
    throw new Error(`Failed to fetch watches: ${watchError.message}`)
  }

  // Count watchers per class
  const watcherCountMap = new Map<string, number>()
  for (const watch of watches || []) {
    watcherCountMap.set(watch.class_nbr, (watcherCountMap.get(watch.class_nbr) || 0) + 1)
  }

  // Combine class states with watcher counts
  const classesWithWatchers: ClassWithWatchers[] = (classStates || [])
    .map((classState) => ({
      ...classState,
      watcher_count: watcherCountMap.get(classState.class_nbr) || 0,
    }))
    .sort((a, b) => b.watcher_count - a.watcher_count)

  console.log(
    `[Admin] Fetched ${classesWithWatchers.length} classes with watcher counts (total watchers: ${watches?.length || 0})`
  )

  return classesWithWatchers
}

/**
 * Get all users with their watch counts
 *
 * Retrieves all users from auth.users and joins with class_watches
 * to show how many classes each user is monitoring. Sorted by created_at descending.
 *
 * @returns Array of users with watch counts
 *
 * @example
 * const users = await getAllUsersWithWatchCount()
 * console.log(`Newest user: ${users[0].email} (${users[0].watch_count} watches)`)
 */
export async function getAllUsersWithWatchCount(): Promise<UserWithWatchCount[]> {
  const supabase = getServiceClient()

  try {
    // Get all users from auth.users
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers()

    if (authError) {
      console.error('[Admin] Error fetching users:', authError)
      throw new Error(`Failed to fetch users: ${authError.message}`)
    }

    const users = authData?.users || []

    if (users.length === 0) {
      return []
    }

    // Get watch counts for all users in one query
    const { data: watchCounts, error: watchError } = await supabase
      .from('class_watches')
      .select('user_id')

    if (watchError) {
      console.error('[Admin] Error fetching watch counts:', watchError)
      throw new Error(`Failed to fetch watch counts: ${watchError.message}`)
    }

    // Count watches per user
    const watchCountMap = new Map<string, number>()
    for (const watch of watchCounts || []) {
      watchCountMap.set(watch.user_id, (watchCountMap.get(watch.user_id) || 0) + 1)
    }

    // Combine user data with watch counts
    const usersWithWatchCount: UserWithWatchCount[] = users
      .map((user) => ({
        id: user.id,
        email: user.email || '',
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at || null,
        email_confirmed_at: user.email_confirmed_at || null,
        watch_count: watchCountMap.get(user.id) || 0,
      }))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    console.log(`[Admin] Fetched ${usersWithWatchCount.length} users with watch counts`)

    return usersWithWatchCount
  } catch (err) {
    console.error('[Admin] Exception fetching users with watch counts:', err)
    throw err
  }
}

/**
 * Get all class watches for a specific user
 *
 * Retrieves all watches for a given user ID and joins with class_states
 * to show full class information. Sorted by created_at descending.
 *
 * @param userId - User ID from auth.users
 * @returns Array of watches with joined class state data
 *
 * @example
 * const watches = await getUserWatches('user-uuid-here')
 * console.log(`User is watching ${watches.length} classes`)
 */
export async function getUserWatches(userId: string): Promise<WatchWithClass[]> {
  const supabase = getServiceClient()

  // Fetch user's class watches
  const { data: watches, error: watchError } = await supabase
    .from('class_watches')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (watchError) {
    console.error(`[Admin] Error fetching watches for user ${userId}:`, watchError)
    throw new Error(`Failed to fetch user watches: ${watchError.message}`)
  }

  if (!watches || watches.length === 0) {
    console.log(`[Admin] No watches found for user ${userId}`)
    return []
  }

  // Fetch corresponding class states
  const classNumbers = watches.map((w) => w.class_nbr)
  const { data: classStates, error: classError } = await supabase
    .from('class_states')
    .select('*')
    .in('class_nbr', classNumbers)

  if (classError) {
    console.error(`[Admin] Error fetching class states for user ${userId}:`, classError)
    throw new Error(`Failed to fetch class states: ${classError.message}`)
  }

  // Create map of class states by class_nbr
  const classStateMap = new Map<string, Tables<'class_states'>>()
  for (const classState of classStates || []) {
    classStateMap.set(classState.class_nbr, classState)
  }

  // Combine watches with class states
  const watchesWithClass: WatchWithClass[] = watches.map((watch) => ({
    ...watch,
    class_state: classStateMap.get(watch.class_nbr) || null,
  }))

  console.log(`[Admin] Fetched ${watchesWithClass.length} watches for user ${userId}`)

  return watchesWithClass
}
