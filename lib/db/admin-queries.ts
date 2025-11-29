/**
 * Admin-Specific Database Queries
 *
 * Reusable admin queries for dashboard metrics and user management.
 * All functions use service role client to bypass RLS.
 *
 * @module lib/db/admin-queries
 */

import type { User } from '@supabase/supabase-js';
import type { Tables } from '@/lib/supabase/database.types';
import { getServiceClient } from '@/lib/supabase/service';

/**
 * Email notification counts (seat and instructor)
 */
export interface EmailCounts {
  seat_emails: number;
  instructor_emails: number;
}

/**
 * Class state with aggregated watcher count
 */
export interface ClassWithWatchers extends Tables<'class_states'> {
  watcher_count: number;
  seat_emails: number;
  instructor_emails: number;
}

/**
 * User information with watch count
 */
export interface UserWithWatchCount {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  watch_count: number;
  is_admin: boolean;
  seat_emails: number;
  instructor_emails: number;
}

/**
 * Class watch with joined class state information
 */
export interface WatchWithClass extends Tables<'class_watches'> {
  class_state: Tables<'class_states'> | null;
}

/**
 * RPC response type for notification counts by class
 */
interface NotificationCountByClassRow {
  class_nbr: string;
  seat_emails: number;
  instructor_emails: number;
}

/**
 * RPC response type for notification counts by user
 */
interface NotificationCountByUserRow {
  user_id: string;
  seat_emails: number;
  instructor_emails: number;
}

async function fetchAllAuthUsers(): Promise<User[]> {
  const supabase = getServiceClient();
  const perPage = 1000;
  let page = 1;
  const users: User[] = [];

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });

    if (error) {
      console.error('[Admin] Error fetching users:', error);
      throw new Error(`Failed to fetch users: ${error.message}`);
    }

    const batch = data?.users || [];
    users.push(...batch);

    if (batch.length < perPage) {
      break;
    }

    page += 1;
  }

  return users;
}

/**
 * Get notification counts grouped by class number
 *
 * Calls the get_notification_counts_by_class RPC function to aggregate
 * seat_available and instructor_assigned notification counts per class.
 *
 * @returns Map of class_nbr to EmailCounts
 */
export async function getNotificationCountsByClass(): Promise<Map<string, EmailCounts>> {
  const supabase = getServiceClient();

  // Cast to unknown first to bypass strict type checking until types are regenerated
  const { data, error } = (await supabase.rpc(
    'get_notification_counts_by_class' as 'get_class_watchers'
  )) as unknown as { data: NotificationCountByClassRow[] | null; error: Error | null };

  if (error) {
    console.error('[Admin] Error fetching notification counts by class:', error);
    throw new Error(`Failed to fetch notification counts by class: ${error.message}`);
  }

  const countsMap = new Map<string, EmailCounts>();
  for (const row of data || []) {
    countsMap.set(row.class_nbr, {
      seat_emails: row.seat_emails || 0,
      instructor_emails: row.instructor_emails || 0,
    });
  }

  return countsMap;
}

/**
 * Get notification counts grouped by user ID
 *
 * Calls the get_notification_counts_by_user RPC function to aggregate
 * seat_available and instructor_assigned notification counts per user.
 *
 * @returns Map of user_id to EmailCounts
 */
export async function getNotificationCountsByUser(): Promise<Map<string, EmailCounts>> {
  const supabase = getServiceClient();

  // Cast to unknown first to bypass strict type checking until types are regenerated
  const { data, error } = (await supabase.rpc(
    'get_notification_counts_by_user' as 'get_class_watchers'
  )) as unknown as { data: NotificationCountByUserRow[] | null; error: Error | null };

  if (error) {
    console.error('[Admin] Error fetching notification counts by user:', error);
    throw new Error(`Failed to fetch notification counts by user: ${error.message}`);
  }

  const countsMap = new Map<string, EmailCounts>();
  for (const row of data || []) {
    countsMap.set(row.user_id, {
      seat_emails: row.seat_emails || 0,
      instructor_emails: row.instructor_emails || 0,
    });
  }

  return countsMap;
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
  const supabase = getServiceClient();

  const { count, error } = await supabase
    .from('notifications_sent')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('[Admin] Error fetching total emails sent:', error);
    throw new Error(`Failed to fetch email count: ${error.message}`);
  }

  return count || 0;
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
  const users = await fetchAllAuthUsers();
  return users.length;
}

/**
 * Get total number of admin users
 *
 * Counts users where is_admin = true in user_profiles table.
 *
 * @returns Total count of admin users
 *
 * @example
 * const total = await getAdminCount()
 * console.log(`Total admins: ${total}`)
 */
export async function getAdminCount(): Promise<number> {
  const supabase = getServiceClient();

  const { count, error } = await supabase
    .from('user_profiles')
    .select('*', { count: 'exact', head: true })
    .eq('is_admin', true);

  if (error) {
    console.error('[Admin] Error fetching admin count:', error);
    throw new Error(`Failed to fetch admin count: ${error.message}`);
  }

  return count || 0;
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
  const supabase = getServiceClient();

  // Fetch all class_nbr values and count unique ones
  const { data: watches, error } = await supabase.from('class_watches').select('class_nbr');

  if (error) {
    console.error('[Admin] Error fetching total classes watched:', error);
    throw new Error(`Failed to fetch class count: ${error.message}`);
  }

  // Count unique class numbers
  const uniqueClasses = new Set(watches?.map((w) => w.class_nbr) || []);
  const count = uniqueClasses.size;

  console.log(`[Admin] Counted ${count} unique classes being watched`);

  return count;
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
  const supabase = getServiceClient();

  // Fetch all class states, watches, and notification counts in parallel
  const [classStatesResult, watchesResult, notificationCounts] = await Promise.all([
    supabase.from('class_states').select('*').order('class_nbr', { ascending: true }),
    supabase.from('class_watches').select('class_nbr'),
    getNotificationCountsByClass(),
  ]);

  const { data: classStates, error: classError } = classStatesResult;
  const { data: watches, error: watchError } = watchesResult;

  if (classError) {
    console.error('[Admin] Error fetching class states:', classError);
    throw new Error(`Failed to fetch classes: ${classError.message}`);
  }

  if (watchError) {
    console.error('[Admin] Error fetching class watches:', watchError);
    throw new Error(`Failed to fetch watches: ${watchError.message}`);
  }

  // Count watchers per class
  const watcherCountMap = new Map<string, number>();
  for (const watch of watches || []) {
    watcherCountMap.set(watch.class_nbr, (watcherCountMap.get(watch.class_nbr) || 0) + 1);
  }

  // Combine class states with watcher counts and notification counts
  const classesWithWatchers: ClassWithWatchers[] = (classStates || [])
    .map((classState) => {
      const emailCounts = notificationCounts.get(classState.class_nbr);
      return {
        ...classState,
        watcher_count: watcherCountMap.get(classState.class_nbr) || 0,
        seat_emails: emailCounts?.seat_emails || 0,
        instructor_emails: emailCounts?.instructor_emails || 0,
      };
    })
    .sort((a, b) => b.watcher_count - a.watcher_count);

  console.log(
    `[Admin] Fetched ${classesWithWatchers.length} classes with watcher counts (total watchers: ${watches?.length || 0})`
  );

  return classesWithWatchers;
}

/**
 * Get all users with their watch counts and admin status
 *
 * Retrieves all users from auth.users and joins with class_watches
 * and user_profiles to show how many classes each user is monitoring
 * and their admin status. Sorted by created_at descending.
 *
 * @returns Array of users with watch counts and admin status
 *
 * @example
 * const users = await getAllUsersWithWatchCount()
 * console.log(`Newest user: ${users[0].email} (${users[0].watch_count} watches, admin: ${users[0].is_admin})`)
 */
export async function getAllUsersWithWatchCount(): Promise<UserWithWatchCount[]> {
  const supabase = getServiceClient();

  try {
    const users = await fetchAllAuthUsers();

    if (users.length === 0) {
      return [];
    }

    // Get watch counts, profiles, and notification counts in parallel
    const [watchCountsResult, profilesResult, notificationCounts] = await Promise.all([
      supabase.from('class_watches').select('user_id'),
      supabase.from('user_profiles').select('user_id, is_admin'),
      getNotificationCountsByUser(),
    ]);

    const { data: watchCounts, error: watchError } = watchCountsResult;
    const { data: profiles, error: profileError } = profilesResult;

    if (watchError) {
      console.error('[Admin] Error fetching watch counts:', watchError);
      throw new Error(`Failed to fetch watch counts: ${watchError.message}`);
    }

    if (profileError) {
      console.error('[Admin] Error fetching user profiles:', profileError);
      throw new Error(`Failed to fetch user profiles: ${profileError.message}`);
    }

    // Count watches per user
    const watchCountMap = new Map<string, number>();
    for (const watch of watchCounts || []) {
      watchCountMap.set(watch.user_id, (watchCountMap.get(watch.user_id) || 0) + 1);
    }

    // Create map of admin status by user_id
    const adminStatusMap = new Map<string, boolean>();
    for (const profile of profiles || []) {
      adminStatusMap.set(profile.user_id, profile.is_admin);
    }

    // Combine user data with watch counts, admin status, and notification counts
    const usersWithWatchCount: UserWithWatchCount[] = users
      .map((user) => {
        const emailCounts = notificationCounts.get(user.id);
        return {
          id: user.id,
          email: user.email || '',
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at || null,
          email_confirmed_at: user.email_confirmed_at || null,
          watch_count: watchCountMap.get(user.id) || 0,
          is_admin: adminStatusMap.get(user.id) || false,
          seat_emails: emailCounts?.seat_emails || 0,
          instructor_emails: emailCounts?.instructor_emails || 0,
        };
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    console.log(`[Admin] Fetched ${usersWithWatchCount.length} users with watch counts`);

    return usersWithWatchCount;
  } catch (err) {
    console.error('[Admin] Exception fetching users with watch counts:', err);
    throw err;
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
  const supabase = getServiceClient();

  // Fetch user's class watches
  const { data: watches, error: watchError } = await supabase
    .from('class_watches')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (watchError) {
    console.error(`[Admin] Error fetching watches for user ${userId}:`, watchError);
    throw new Error(`Failed to fetch user watches: ${watchError.message}`);
  }

  if (!watches || watches.length === 0) {
    console.log(`[Admin] No watches found for user ${userId}`);
    return [];
  }

  // Fetch corresponding class states
  const classNumbers = watches.map((w) => w.class_nbr);
  const { data: classStates, error: classError } = await supabase
    .from('class_states')
    .select('*')
    .in('class_nbr', classNumbers);

  if (classError) {
    console.error(`[Admin] Error fetching class states for user ${userId}:`, classError);
    throw new Error(`Failed to fetch class states: ${classError.message}`);
  }

  // Create map of class states by class_nbr
  const classStateMap = new Map<string, Tables<'class_states'>>();
  for (const classState of classStates || []) {
    classStateMap.set(classState.class_nbr, classState);
  }

  // Combine watches with class states
  const watchesWithClass: WatchWithClass[] = watches.map((watch) => ({
    ...watch,
    class_state: classStateMap.get(watch.class_nbr) || null,
  }));

  console.log(`[Admin] Fetched ${watchesWithClass.length} watches for user ${userId}`);

  return watchesWithClass;
}
