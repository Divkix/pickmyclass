/**
 * Admin-Specific Database Queries
 *
 * Reusable admin queries for dashboard metrics and user management.
 * All functions use service role client to bypass RLS.
 *
 * @module lib/db/admin-queries
 */

import { TtlCache } from '@/lib/cache/ttl-cache';
import { ADMIN_CACHE_TTL_MS } from '@/lib/config';
import { log } from '@/lib/log';
import { sectionRefKey } from '@/lib/section-ref';
import type { Database, Tables } from '@/lib/supabase/database.types';
import { getServiceClient } from '@/lib/supabase/service';
import type { NotificationType } from '@/lib/types/notification';

type PaginatedRpcMap = {
  get_users_page: {
    Args: Database['public']['Functions']['get_users_page']['Args'];
    Row: Database['public']['Functions']['get_users_page']['Returns'][number];
  };
  get_classes_page: {
    Args: Database['public']['Functions']['get_classes_page']['Args'];
    Row: Database['public']['Functions']['get_classes_page']['Returns'][number];
  };
};

type PaginatedRpcName = keyof PaginatedRpcMap;

type PaginatedMeta = {
  total_count: number;
  total_watchers?: number | null;
  full_classes?: number | null;
};

function isPaginatedRpcName(value: string): value is PaginatedRpcName {
  return value === 'get_users_page' || value === 'get_classes_page';
}

function assertPaginatedRpcName(value: string): asserts value is PaginatedRpcName {
  if (!isPaginatedRpcName(value)) {
    throw new Error(`Unsupported paginated RPC: ${value}`);
  }
}


const adminCache = new TtlCache<unknown>(ADMIN_CACHE_TTL_MS, 100);

async function cachedQuery<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  // SAFETY: cache get returns unknown, narrowing via generic fetched value
  const cached = adminCache.get(key) as T | undefined;
  if (cached !== undefined) return cached;
  const result = await fetcher();
  adminCache.set(key, result);
  return result;
}

async function fetchPaginatedPage<N extends PaginatedRpcName, T>(
  rpcName: N,
  params: PaginatedRpcMap[N]['Args'],
  mapper: (row: PaginatedRpcMap[N]['Row']) => T
): Promise<{ data: T[]; total: number; totalWatchers?: number; fullClasses?: number }> {
  // SAFETY: runtime guard narrows rpcName to known union; ensures misspelled name throws even if compile-time check is bypassed via assertion
  assertPaginatedRpcName(rpcName);
  const supabase = getServiceClient();

  let rawData: PaginatedRpcMap[N]['Row'][] | null = null;
  let rpcError: { message: string } | null = null;

  if (rpcName === 'get_users_page') {
    // SAFETY: branch narrows rpcName; params correlates to GetUsersPageRpcArgs via generic constraint
    const { data, error } = await supabase.rpc(
      'get_users_page',
      // SAFETY: params type correlates via N generic and branch narrowing
      params as PaginatedRpcMap['get_users_page']['Args']
    );
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: data typed per Database; cast to generic row array for unified handling via unknown intermediate (unavoidable generic correlation)
    rawData = data as unknown as PaginatedRpcMap[N]['Row'][] | null;
    rpcError = error;
  } else if (rpcName === 'get_classes_page') {
    // SAFETY: branch narrows rpcName; params correlates to GetClassesPageRpcArgs via generic constraint
    const { data, error } = await supabase.rpc(
      'get_classes_page',
      // SAFETY: params type correlates via N generic and branch narrowing
      params as PaginatedRpcMap['get_classes_page']['Args']
    );
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: data typed per Database; cast to generic row array for unified handling via unknown intermediate (unavoidable generic correlation)
    rawData = data as unknown as PaginatedRpcMap[N]['Row'][] | null;
    rpcError = error;
  } else {
    const _exhaustive: never = rpcName;
    // SAFETY: never narrowed to string for error message; exhaustiveness check ensures no runtime value reaches here
    throw new Error(`Unsupported paginated RPC: ${_exhaustive as string}`);
  }

  if (rpcError) {
    log('Admin').error(`Error fetching ${rpcName}:`, rpcError);
    const friendly = rpcName === 'get_classes_page' ? 'classes page' : 'users page';
    throw new Error(`Failed to fetch ${friendly}: ${rpcError.message}`);
  }
  // SAFETY: rawData and mapper correlate via N; centralize mapping without per-field any
  const rows: T[] = (rawData ?? []).map((row) => mapper(row));
  // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: centralize pagination meta extraction via PaginatedMeta; handles empty data and missing columns with ??0
  const meta = rawData?.[0] as unknown as PaginatedMeta | undefined;
  const total = meta ? Number(meta.total_count ?? 0) : 0;
  const totalWatchers = meta?.total_watchers != null ? Number(meta.total_watchers) : undefined;
  const fullClasses = meta?.full_classes != null ? Number(meta.full_classes) : undefined;
  if (totalWatchers !== undefined && fullClasses !== undefined) {
    return { data: rows, total, totalWatchers, fullClasses };
  }
  if (totalWatchers !== undefined) {
    return { data: rows, total, totalWatchers };
  }
  if (fullClasses !== undefined) {
    return { data: rows, total, fullClasses };
  }
  return { data: rows, total };
}

/**
 * Class state with aggregated watcher count
 */
export interface ClassWithWatchers extends Tables<'class_states'> {
  watcher_count: number;
  seat_emails: number;
  instructor_emails: number;
}

type NotificationStatus = 'active' | 'unsubscribed' | 'bounced' | 'spam' | 'disabled';

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
  notification_status: NotificationStatus;
}

/**
 * Class watch with joined class state information
 */
interface WatchWithClass extends Tables<'class_watches'> {
  class_state: Tables<'class_states'> | null;
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
  return cachedQuery<number>('total-emails-sent', async () => {
    const supabase = getServiceClient();
    const { count, error } = await supabase
      .from('notifications_sent')
      .select('*', { count: 'exact', head: true });
    if (error) {
      log('Admin').error('Error fetching total emails sent:', error);
      throw new Error(`Failed to fetch email count: ${error.message}`);
    }
    return count || 0;
  });
}

/**
 * Get total number of registered users
 *
 * Counts rows in user_profiles (1:1 with auth.users via on_auth_user_created
 * trigger from migration 20251024120000). Replaces the old 50-page
 * auth.admin.listUsers walk.
 *
 * @returns Total count of registered users
 *
 * @example
 * const total = await getTotalUsers()
 */
export async function getTotalUsers(): Promise<number> {
  return cachedQuery<number>('total-users', async () => {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc('count_all_users');
    if (error) {
      log('Admin').error('Error counting users:', error);
      throw new Error(`Failed to count users: ${error.message}`);
    }
    return Number(data ?? 0);
  });
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
  return cachedQuery<number>('admin-count', async () => {
    const supabase = getServiceClient();
    const { count, error } = await supabase
      .from('user_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('is_admin', true);
    if (error) {
      log('Admin').error('Error fetching admin count:', error);
      throw new Error(`Failed to fetch admin count: ${error.message}`);
    }
    return count || 0;
  });
}

/**
 * Get total number of unique classes being watched
 *
 * Calls the count_distinct_classes_watched RPC (SELECT COUNT(DISTINCT class_nbr))
 * instead of fetching all rows and building a Set in application memory.
 *
 * @returns Total count of unique classes
 *
 * @example
 * const total = await getTotalClassesWatched()
 */
export async function getTotalClassesWatched(): Promise<number> {
  return cachedQuery<number>('total-classes-watched', async () => {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc('count_distinct_classes_watched');
    if (error) {
      log('Admin').error('Error counting distinct classes watched:', error);
      throw new Error(`Failed to fetch class count: ${error.message}`);
    }
    const result = Number(data ?? 0);
    log('Admin').info(`Counted ${result} unique classes being watched`);
    return result;
  });
}
// ─── Paginated query parameters ─────────────────────────────────────────────

export type UserSortField =
  | 'email'
  | 'created_at'
  | 'last_sign_in_at'
  | 'watch_count'
  | 'seat_emails'
  | 'instructor_emails';

export type ClassSortField =
  | 'class_nbr'
  | 'subject'
  | 'seats_available'
  | 'watcher_count'
  | 'seat_emails'
  | 'instructor_emails'
  | 'last_checked_at';

type SortDirection = 'asc' | 'desc';
type WatchCountFilter = 'all' | 'none' | '1-5' | '6-10' | '10+';

export interface GetUsersPageParams {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: 'all' | 'admin' | 'user';
  verified?: 'all' | 'verified' | 'unverified';
  watchCount?: WatchCountFilter;
  sort?: UserSortField;
  dir?: SortDirection;
}

export interface GetClassesPageParams {
  page?: number;
  pageSize?: number;
  search?: string;
  subject?: string;
  seatStatus?: 'all' | 'full' | 'limited' | 'available';
  instructor?: 'all' | 'staff' | 'named';
  watcherCount?: WatchCountFilter;
  sort?: ClassSortField;
  dir?: SortDirection;
}

export interface UsersPage {
  rows: UserWithWatchCount[];
  total: number;
}

export interface ClassesPage {
  rows: ClassWithWatchers[];
  total: number;
  totalWatchers: number;
  fullClasses: number;
}

/**
 * Get a single page of users for the admin dashboard
 *
 * Calls get_users_page RPC which applies all filter/sort dimensions in SQL
 * and returns only the requested page of rows for the table render path.
 *
 * @param params - Page, sort, and filter parameters
 * @returns Paginated result with rows and total matching count
 */
export async function getUsersPage(params: GetUsersPageParams = {}): Promise<UsersPage> {
  const {
    page = 1,
    pageSize = 25,
    search = '',
    role = 'all',
    verified = 'all',
    watchCount = 'all',
    sort = 'created_at',
    dir = 'desc',
  } = params;

  const { data: rows, total } = await fetchPaginatedPage(
    'get_users_page',
    {
      p_page: page,
      p_page_size: pageSize,
      p_search: search,
      p_role: role,
      p_verified: verified,
      p_watch_count: watchCount,
      p_sort: sort,
      p_dir: dir,
    },
    (row) => ({
      id: row.id,
      email: row.email,
      created_at: row.created_at,
      last_sign_in_at: row.last_sign_in_at ?? null,
      email_confirmed_at: row.email_confirmed_at ?? null,
      watch_count: Number(row.watch_count),
      is_admin: row.is_admin,
      seat_emails: Number(row.seat_emails),
      instructor_emails: Number(row.instructor_emails),
      // SAFETY: get_users_page RPC constrains notification_status to NotificationStatus via DB check constraint
      notification_status: row.notification_status as NotificationStatus,
    })
  );

  log('Admin').info(`Fetched ${rows.length} users (page ${page}, total ${total})`);

  return { rows, total };
}

/**
 * Get a single page of classes for the admin dashboard
 *
 * Calls get_classes_page RPC which applies all filter/sort dimensions in SQL
 * and returns only the requested page of rows for the table render path.
 *
 * @param params - Page, sort, and filter parameters
 * @returns Paginated result with rows and total matching count
 */
export async function getClassesPage(params: GetClassesPageParams = {}): Promise<ClassesPage> {
  const {
    page = 1,
    pageSize = 25,
    search = '',
    subject = 'all',
    seatStatus = 'all',
    instructor = 'all',
    watcherCount = 'all',
    sort = 'watcher_count',
    dir = 'desc',
  } = params;

  const {
    data: rows,
    total,
    totalWatchers = 0,
    fullClasses = 0,
  } = await fetchPaginatedPage(
    'get_classes_page',
    {
      p_page: page,
      p_page_size: pageSize,
      p_search: search,
      p_subject: subject,
      p_seat_status: seatStatus,
      p_instructor: instructor,
      p_watcher_count: watcherCount,
      p_sort: sort,
      p_dir: dir,
    },
    (row) => ({
      id: row.id,
      class_nbr: row.class_nbr,
      term: row.term,
      subject: row.subject,
      catalog_nbr: row.catalog_nbr,
      title: row.title ?? null,
      instructor_name: row.instructor_name ?? null,
      seats_available: row.seats_available,
      seats_capacity: row.seats_capacity,
      non_reserved_seats: row.non_reserved_seats ?? null,
      location: row.location ?? null,
      meeting_times: row.meeting_times ?? null,
      last_checked_at: row.last_checked_at,
      last_changed_at: row.last_changed_at,
      watcher_count: Number(row.watcher_count),
      seat_emails: Number(row.seat_emails),
      instructor_emails: Number(row.instructor_emails),
    })
  );

  log('Admin').info(`Fetched ${rows.length} classes (page ${page}, total ${total})`);

  return { rows, total, totalWatchers, fullClasses };
}

/**
 * Get distinct subject codes from class_states
 *
 * Calls get_distinct_subjects RPC to populate the subject filter drop-down
 * on the admin classes page.
 *
 * @returns Sorted array of subject codes
 */
export async function getDistinctSubjects(): Promise<string[]> {
  // SAFETY: adminCache only stores string arrays written by getDistinctSubjects; miss returns undefined
  const cached = adminCache.get('distinct-subjects') as string[] | undefined;
  if (cached !== undefined) return cached;

  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc('get_distinct_subjects');

  if (error) {
    log('Admin').error('Error fetching distinct subjects:', error);
    throw new Error(`Failed to fetch subjects: ${error.message}`);
  }

  const result = (data ?? []).map((r) => r.subject);
  adminCache.set('distinct-subjects', result);
  return result;
}

/**
 * A single recent activity item returned from the unified feed.
 */

type ActivityType = 'user_registration' | 'new_watch' | 'email_sent';

export interface RecentActivityItem {
  type: ActivityType;
  activityAt: string;
  userEmail: string;
  classNbr: string | null;
  subject: string | null;
  catalogNbr: string | null;
  notificationType: NotificationType | null;
}

/**
 * Get the most recent platform activity.
 *
 * Calls the `get_recent_activity` RPC which unions:
 * - `auth.users` (registrations)
 * - `class_watches` (new watches)
 * - `notifications_sent` (email notifications)
 *
 * Results are cached for 10 minutes.
 *
 * @param limit - Maximum number of items to return (default: 50)
 * @returns Array of unified activity items ordered by `activityAt` descending
 */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: boundary helper narrows unknown catch error via code property check
function isMissingRecentActivityRpcError(error: unknown): boolean {
  // SAFETY: Supabase PostgREST error shape always includes optional code; narrowing caught error at boundary
  const maybeError = error as { code?: string };
  return maybeError.code === 'PGRST202' || maybeError.code === '42883';
}

export async function getRecentActivity(limit: number = 50): Promise<RecentActivityItem[]> {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new TypeError('Invalid limit: must be a finite positive integer');
  }
  const sanitizedLimit = Math.min(500, Math.max(1, Math.floor(limit)));

  const cacheKey = `recent-activity-${sanitizedLimit}`;
  // SAFETY: adminCache only stores RecentActivityItem arrays written by getRecentActivity; miss returns undefined
  const cached = adminCache.get(cacheKey) as RecentActivityItem[] | undefined;
  if (cached !== undefined) return cached;

  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc('get_recent_activity', { p_limit: sanitizedLimit });

  if (error) {
    if (isMissingRecentActivityRpcError(error)) {
      const fallback: RecentActivityItem[] = [];
      log('Admin').warn('Recent activity RPC is unavailable; rendering an empty activity feed');
      adminCache.set(cacheKey, fallback);
      return fallback;
    }

    log('Admin').error('Error fetching recent activity:', error);
    throw new Error(`Failed to fetch recent activity: ${error.message}`);
  }

  const items: RecentActivityItem[] = (data || []).map((row) => ({
    // SAFETY: get_recent_activity RPC constrains activity_type to ActivityType union via DB check constraint
    type: row.activity_type as ActivityType,
    activityAt: row.activity_at,
    userEmail: row.user_email,
    classNbr: row.class_nbr,
    subject: row.subject,
    catalogNbr: row.catalog_nbr,
    // SAFETY: get_recent_activity RPC constrains notification_type to allowed union or null via DB check constraint
    notificationType: row.notification_type as NotificationType | null,
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
    .select('id, user_id, class_nbr, term, subject, catalog_nbr, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (watchError) {
    log('Admin').error(`Error fetching watches for user ${userId}:`, watchError);
    throw new Error(`Failed to fetch user watches: ${watchError.message}`);
  }

  if (!watches || watches.length === 0) {
    log('Admin').info(`No watches found for user ${userId}`);
    return [];
  }

  const classNumbers = watches.map((w) => w.class_nbr);
  const { data: classStates, error: classError } = await supabase
    .from('class_states')
    .select(
      'id, class_nbr, term, subject, catalog_nbr, title, instructor_name, seats_available, seats_capacity, non_reserved_seats, location, meeting_times, last_checked_at, last_changed_at'
    )
    .in('class_nbr', classNumbers);

  if (classError) {
    log('Admin').error(`Error fetching class states for user ${userId}:`, classError);
    throw new Error(`Failed to fetch class states: ${classError.message}`);
  }

  // Key by sectionRefKey ({ class_nbr, term }) so a class_nbr watched in two
  // terms joins each watch to its own term's state instead of one overwriting
  // the other. The .in('class_nbr', ...) fetch above returns rows for every
  // matching term, which this map now keeps distinct.
  const classStateMap = new Map<string, Tables<'class_states'>>();
  for (const classState of classStates || []) {
    classStateMap.set(sectionRefKey(classState), classState);
  }

  const watchesWithClass: WatchWithClass[] = watches.map((watch) => ({
    ...watch,
    class_state: classStateMap.get(sectionRefKey(watch)) || null,
  }));

  log('Admin').info(`Fetched ${watchesWithClass.length} watches for user ${userId}`);

  return watchesWithClass;
}
