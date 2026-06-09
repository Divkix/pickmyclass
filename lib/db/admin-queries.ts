/**
 * Admin-Specific Database Queries
 *
 * Reusable admin queries for dashboard metrics and user management.
 * All functions use service role client to bypass RLS.
 *
 * @module lib/db/admin-queries
 */

import type { User } from '@supabase/supabase-js';
import { TtlCache } from '@/lib/cache/ttl-cache';
import type { Tables } from '@/lib/supabase/database.types';
import { getServiceClient } from '@/lib/supabase/service';

const adminCache = new TtlCache<unknown>(600_000);

/**
 * Email notification counts (seat and instructor)
 */
interface EmailCounts {
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
 * Engagement status for a user
 */
export type EngagementStatus = 'healthy' | 'low' | 'disabled' | 'new';

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
  // Engagement tracking
  engagement_emails_sent: number;
  engagement_emails_opened: number;
  engagement_rate: number | null;
  engagement_status: EngagementStatus;
}

/**
 * Class watch with joined class state information
 */
interface WatchWithClass extends Tables<'class_watches'> {
  class_state: Tables<'class_states'> | null;
}

/**
 * RPC response type for engagement stats
 */
interface EngagementStatsRow {
  user_id: string;
  engagement_emails_sent: number;
  engagement_emails_opened: number;
  engagement_rate: number | null;
  engagement_status: EngagementStatus;
}

async function fetchAllAuthUsers(): Promise<User[]> {
  const supabase = getServiceClient();
  const perPage = 1000;
  const maxPages = 50; // Cap at 50,000 users
  let page = 1;
  const users: User[] = [];

  while (page <= maxPages) {
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

  if (page > maxPages) {
    console.warn(`[Admin] User fetch capped at ${maxPages * perPage} users`);
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
async function getNotificationCountsByClass(): Promise<Map<string, EmailCounts>> {
  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc('get_notification_counts_by_class');

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
async function getNotificationCountsByUser(): Promise<Map<string, EmailCounts>> {
  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc('get_notification_counts_by_user');

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
 * Get engagement statistics for all users
 *
 * Calls the get_user_engagement_stats RPC function to retrieve
 * engagement tracking data for admin dashboard.
 *
 * @returns Map of user_id to engagement stats
 */
async function getEngagementStats(): Promise<Map<string, EngagementStatsRow>> {
  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc('get_user_engagement_stats');

  if (error) {
    console.error('[Admin] Error fetching engagement stats:', error);
    throw new Error(`Failed to fetch engagement stats: ${error.message}`);
  }

  const statsMap = new Map<string, EngagementStatsRow>();
  for (const row of data || []) {
    statsMap.set(row.user_id, {
      ...row,
      engagement_status: row.engagement_status as EngagementStatus,
    });
  }

  return statsMap;
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
 */
export async function getTotalEmailsSent(): Promise<number> {
  const cached = adminCache.get('total-emails-sent') as number | undefined;
  if (cached !== undefined) return cached;

  const supabase = getServiceClient();

  const { count, error } = await supabase
    .from('notifications_sent')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('[Admin] Error fetching total emails sent:', error);
    throw new Error(`Failed to fetch email count: ${error.message}`);
  }

  const result = count || 0;
  adminCache.set('total-emails-sent', result);
  return result;
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
 */
export async function getTotalUsers(): Promise<number> {
  const cached = adminCache.get('total-users') as number | undefined;
  if (cached !== undefined) return cached;

  const users = await fetchAllAuthUsers();
  const result = users.length;
  adminCache.set('total-users', result);
  return result;
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
 */
export async function getAdminCount(): Promise<number> {
  const cached = adminCache.get('admin-count') as number | undefined;
  if (cached !== undefined) return cached;

  const supabase = getServiceClient();

  const { count, error } = await supabase
    .from('user_profiles')
    .select('*', { count: 'exact', head: true })
    .eq('is_admin', true);

  if (error) {
    console.error('[Admin] Error fetching admin count:', error);
    throw new Error(`Failed to fetch admin count: ${error.message}`);
  }

  const result = count || 0;
  adminCache.set('admin-count', result);
  return result;
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
 */
export async function getTotalClassesWatched(): Promise<number> {
  const cached = adminCache.get('total-classes-watched') as number | undefined;
  if (cached !== undefined) return cached;

  const supabase = getServiceClient();

  const { data: watches, error } = await supabase.from('class_watches').select('class_nbr');

  if (error) {
    console.error('[Admin] Error fetching total classes watched:', error);
    throw new Error(`Failed to fetch class count: ${error.message}`);
  }

  const uniqueClasses = new Set(watches?.map((w) => w.class_nbr) || []);
  const result = uniqueClasses.size;

  console.log(`[Admin] Counted ${result} unique classes being watched`);

  adminCache.set('total-classes-watched', result);
  return result;
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
 */
export async function getAllClassesWithWatchers(): Promise<ClassWithWatchers[]> {
  const cached = adminCache.get('classes-with-watchers') as ClassWithWatchers[] | undefined;
  if (cached !== undefined) return cached;

  const supabase = getServiceClient();

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

  const watcherCountMap = new Map<string, number>();
  for (const watch of watches || []) {
    watcherCountMap.set(watch.class_nbr, (watcherCountMap.get(watch.class_nbr) || 0) + 1);
  }

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

  adminCache.set('classes-with-watchers', classesWithWatchers);
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
 */
export async function getAllUsersWithWatchCount(): Promise<UserWithWatchCount[]> {
  const cached = adminCache.get('users-with-watch-count') as UserWithWatchCount[] | undefined;
  if (cached !== undefined) return cached;

  const supabase = getServiceClient();

  try {
    const users = await fetchAllAuthUsers();

    if (users.length === 0) {
      return [];
    }

    const [watchCountsResult, profilesResult, notificationCounts, engagementStats] =
      await Promise.all([
        supabase.from('class_watches').select('user_id'),
        supabase.from('user_profiles').select('user_id, is_admin'),
        getNotificationCountsByUser(),
        getEngagementStats(),
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

    const watchCountMap = new Map<string, number>();
    for (const watch of watchCounts || []) {
      watchCountMap.set(watch.user_id, (watchCountMap.get(watch.user_id) || 0) + 1);
    }

    const adminStatusMap = new Map<string, boolean>();
    for (const profile of profiles || []) {
      adminStatusMap.set(profile.user_id, profile.is_admin);
    }
    const usersWithWatchCount: UserWithWatchCount[] = users
      .map((user) => {
        const emailCounts = notificationCounts.get(user.id);
        const engagement = engagementStats.get(user.id);
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
          // Engagement tracking
          engagement_emails_sent: engagement?.engagement_emails_sent || 0,
          engagement_emails_opened: engagement?.engagement_emails_opened || 0,
          engagement_rate: engagement?.engagement_rate ?? null,
          engagement_status: engagement?.engagement_status || 'new',
        };
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    console.log(`[Admin] Fetched ${usersWithWatchCount.length} users with watch counts`);

    adminCache.set('users-with-watch-count', usersWithWatchCount);
    return usersWithWatchCount;
  } catch (err) {
    console.error('[Admin] Exception fetching users with watch counts:', err);
    throw err;
  }
}

/**
 * A single recent activity item returned from the unified feed.
 */

export type ActivityType = 'user_registration' | 'new_watch' | 'email_sent';

export interface RecentActivityItem {
  type: ActivityType;
  activityAt: string;
  userEmail: string;
  classNbr: string | null;
  subject: string | null;
  catalogNbr: string | null;
  notificationType: 'seat_available' | 'instructor_assigned' | null;
}

/**
 * Get the most recent platform activity.
 *
 * Calls the `get_recent_activity` RPC which unions:
 * - `auth.users` (registrations)
 * - `class_watches` (new watches)
 * - `notifications_sent` (email notifications)
 *
 * Results are cached for 5 minutes.
 *
 * @param limit - Maximum number of items to return (default: 50)
 * @returns Array of unified activity items ordered by `activityAt` descending
 */
function isMissingRecentActivityRpcError(error: unknown): boolean {
  const maybeError = error as { code?: string };
  return maybeError.code === 'PGRST202' || maybeError.code === '42883';
}

export async function getRecentActivity(limit: number = 50): Promise<RecentActivityItem[]> {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new TypeError('Invalid limit: must be a finite positive integer');
  }
  const sanitizedLimit = Math.min(500, Math.max(1, Math.floor(limit)));

  const cacheKey = `recent-activity-${sanitizedLimit}`;
  const cached = adminCache.get(cacheKey) as RecentActivityItem[] | undefined;
  if (cached !== undefined) return cached;

  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc('get_recent_activity', { p_limit: sanitizedLimit });

  if (error) {
    if (isMissingRecentActivityRpcError(error)) {
      const fallback: RecentActivityItem[] = [];
      console.warn('[Admin] Recent activity RPC is unavailable; rendering an empty activity feed');
      adminCache.set(cacheKey, fallback);
      return fallback;
    }

    console.error('[Admin] Error fetching recent activity:', error);
    throw new Error(`Failed to fetch recent activity: ${error.message}`);
  }

  const items: RecentActivityItem[] = (data || []).map((row) => ({
    type: row.activity_type as ActivityType,
    activityAt: row.activity_at,
    userEmail: row.user_email,
    classNbr: row.class_nbr,
    subject: row.subject,
    catalogNbr: row.catalog_nbr,
    notificationType: row.notification_type as 'seat_available' | 'instructor_assigned' | null,
  }));

  adminCache.set(cacheKey, items);
  return items;
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

  const classNumbers = watches.map((w) => w.class_nbr);
  const { data: classStates, error: classError } = await supabase
    .from('class_states')
    .select('*')
    .in('class_nbr', classNumbers);

  if (classError) {
    console.error(`[Admin] Error fetching class states for user ${userId}:`, classError);
    throw new Error(`Failed to fetch class states: ${classError.message}`);
  }

  const classStateMap = new Map<string, Tables<'class_states'>>();
  for (const classState of classStates || []) {
    classStateMap.set(classState.class_nbr, classState);
  }

  const watchesWithClass: WatchWithClass[] = watches.map((watch) => ({
    ...watch,
    class_state: classStateMap.get(watch.class_nbr) || null,
  }));

  console.log(`[Admin] Fetched ${watchesWithClass.length} watches for user ${userId}`);

  return watchesWithClass;
}
