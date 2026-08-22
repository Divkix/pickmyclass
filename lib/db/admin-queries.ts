/**
 * Admin-Specific Database Queries
 *
 * Reusable admin queries for dashboard metrics and user management.
 * All functions use the Hyperdrive-backed pg query seam.
 *
 * @module lib/db/admin-queries
 */

import { callFunction, callFunctionScalar, query, queryScalar } from '@/lib/db/client';
import type {
  ClassesPageRpcRow,
  ClassStateRow,
  ClassWatchRow,
  RecentActivityRpcRow,
  UsersPageRpcRow,
} from '@/lib/db/types';
import { TtlCache } from '@/lib/cache/ttl-cache';
import { ADMIN_CACHE_TTL_MS } from '@/lib/config';
import { log } from '@/lib/log';
import { sectionRefKey } from '@/lib/section-ref';
import type { NotificationType } from '@/lib/types/notification';

// eslint-disable-next-line anti-slop/no-unknown-parameters, ts-no-tiny-functions -- SAFETY: dedup 3+ consecutive_not_found_count fallbacks (getClassesPage + getUserWatches + future); preserves ??0 invariant — row is untyped pg payload narrowed via cast
function normalizeConsecutiveCount(row: unknown): number {
  // SAFETY: pg query may omit column in stale cache; narrow to optional count shape — fallback to 0 preserves invariant
  return (row as { consecutive_not_found_count?: number | null }).consecutive_not_found_count ?? 0;
}

// Reuse a single cache instance across all admin queries
const adminCache = new TtlCache<unknown>(ADMIN_CACHE_TTL_MS, 100);

// ─── Shared helpers ─────────────────────────────────────────────────────────

type NotificationStatus = 'active' | 'unsubscribed' | 'bounced' | 'spam' | 'disabled';

type SortDirection = 'asc' | 'desc';
type WatchCountFilter = 'all' | 'none' | '1-5' | '6-10' | '10+';

// ─── Simple count queries ───────────────────────────────────────────────────

/**
 * Get total number of emails sent
 */
export async function getTotalEmailsSent(): Promise<number> {
  // SAFETY: adminCache stores unknown; narrowing to number via cache key contract
  const cached = adminCache.get('total-emails-sent') as number | undefined;
  if (cached !== undefined) return cached;

  try {
    const count = await queryScalar<number>(
      'SELECT COUNT(*)::int AS count FROM notifications_sent'
    );
    const result = Number(count ?? 0);
    adminCache.set('total-emails-sent', result);
    return result;
  } catch (error) {
    log('Admin').error('Error fetching total emails sent:', error);
    throw new Error(
      `Failed to fetch email count: ${error instanceof Error ? error.message : error}`
    );
  }
}

/**
 * Get total number of registered users
 */
export async function getTotalUsers(): Promise<number> {
  // SAFETY: adminCache stores unknown; narrowing to number via cache key contract
  const cached = adminCache.get('total-users') as number | undefined;
  if (cached !== undefined) return cached;

  try {
    const count = await callFunctionScalar<number>('count_all_users');
    const result = Number(count ?? 0);
    adminCache.set('total-users', result);
    return result;
  } catch (error) {
    log('Admin').error('Error counting users:', error);
    throw new Error(`Failed to count users: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Get total number of admin users
 */
export async function getAdminCount(): Promise<number> {
  // SAFETY: adminCache stores unknown; narrowing to number via cache key contract
  const cached = adminCache.get('admin-count') as number | undefined;
  if (cached !== undefined) return cached;

  try {
    const count = await queryScalar<number>(
      'SELECT COUNT(*)::int AS count FROM user_profiles WHERE is_admin = true'
    );
    const result = Number(count ?? 0);
    adminCache.set('admin-count', result);
    return result;
  } catch (error) {
    log('Admin').error('Error fetching admin count:', error);
    throw new Error(
      `Failed to fetch admin count: ${error instanceof Error ? error.message : error}`
    );
  }
}

/**
 * Get total number of unique classes being watched
 */
export async function getTotalClassesWatched(): Promise<number> {
  // SAFETY: adminCache stores unknown; narrowing to number via cache key contract
  const cached = adminCache.get('total-classes-watched') as number | undefined;
  if (cached !== undefined) return cached;

  try {
    const count = await callFunctionScalar<number>('count_distinct_classes_watched');
    const result = Number(count ?? 0);
    log('Admin').info(`Counted ${result} unique classes being watched`);
    adminCache.set('total-classes-watched', result);
    return result;
  } catch (error) {
    log('Admin').error('Error counting distinct classes watched:', error);
    throw new Error(
      `Failed to fetch class count: ${error instanceof Error ? error.message : error}`
    );
  }
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

// ─── Result types ───────────────────────────────────────────────────────────

/**
 * Class state with aggregated watcher count
 */
export interface ClassWithWatchers extends ClassStateRow {
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
  notification_status: NotificationStatus;
}

/**
 * Class watch with joined class state information
 */
interface WatchWithClass extends ClassWatchRow {
  class_state: ClassStateRow | null;
}

// ─── Paginated queries ──────────────────────────────────────────────────────

/**
 * Get a single page of users for the admin dashboard
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

  try {
    const rows = await callFunction<UsersPageRpcRow>('get_users_page', [
      page,
      pageSize,
      search,
      role,
      verified,
      watchCount,
      sort,
      dir,
    ]);

    const mapped: UserWithWatchCount[] = rows.map((row) => ({
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
    }));

    const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;

    log('Admin').info(`Fetched ${mapped.length} users (page ${page}, total ${total})`);
    return { rows: mapped, total };
  } catch (error) {
    log('Admin').error(`Error fetching users page:`, error);
    throw new Error(
      `Failed to fetch users page: ${error instanceof Error ? error.message : error}`
    );
  }
}

/**
 * Get a single page of classes for the admin dashboard
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

  try {
    const rows = await callFunction<ClassesPageRpcRow>('get_classes_page', [
      page,
      pageSize,
      search,
      subject,
      seatStatus,
      instructor,
      watcherCount,
      sort,
      dir,
    ]);

    const mapped: ClassWithWatchers[] = rows.map((row) => ({
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
      consecutive_not_found_count: normalizeConsecutiveCount(row),
      watcher_count: Number(row.watcher_count),
      seat_emails: Number(row.seat_emails),
      instructor_emails: Number(row.instructor_emails),
    }));

    const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
    const totalWatchers = rows.length > 0 ? Number(rows[0].total_watchers ?? 0) : 0;
    const fullClasses = rows.length > 0 ? Number(rows[0].full_classes ?? 0) : 0;

    log('Admin').info(`Fetched ${mapped.length} classes (page ${page}, total ${total})`);
    return { rows: mapped, total, totalWatchers, fullClasses };
  } catch (error) {
    log('Admin').error(`Error fetching classes page:`, error);
    throw new Error(
      `Failed to fetch classes page: ${error instanceof Error ? error.message : error}`
    );
  }
}

// ─── Non-paginated queries ──────────────────────────────────────────────────

/**
 * Get distinct subject codes from class_states
 */
export async function getDistinctSubjects(): Promise<string[]> {
  // SAFETY: adminCache stores unknown; narrowing to string[] via cache key contract
  const cached = adminCache.get('distinct-subjects') as string[] | undefined;
  if (cached !== undefined) return cached;

  try {
    const rows = await callFunction<{ subject: string }>('get_distinct_subjects');
    const result = rows.map((r) => r.subject);
    adminCache.set('distinct-subjects', result);
    return result;
  } catch (error) {
    log('Admin').error('Error fetching distinct subjects:', error);
    throw new Error(`Failed to fetch subjects: ${error instanceof Error ? error.message : error}`);
  }
}

// ─── Recent activity ────────────────────────────────────────────────────────

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
 * Check whether an error indicates the recent activity RPC is missing.
 * With raw SQL, PostgreSQL error code 42883 = undefined function.
 */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: boundary helper narrows unknown catch error via code property check
function isMissingRecentActivityRpcError(error: unknown): boolean {
  // SAFETY: caught error is a pg DatabaseError; narrowing to access the code property
  const pgError = error as { code?: string };
  return pgError.code === '42883';
}

/**
 * Get the most recent platform activity.
 */
export async function getRecentActivity(limit: number = 50): Promise<RecentActivityItem[]> {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new TypeError('Invalid limit: must be a finite positive integer');
  }
  const sanitizedLimit = Math.min(500, Math.max(1, Math.floor(limit)));

  const cacheKey = `recent-activity-${sanitizedLimit}`;
  // SAFETY: adminCache stores unknown; narrowing to RecentActivityItem[] via cache key contract
  const cached = adminCache.get(cacheKey) as RecentActivityItem[] | undefined;
  if (cached !== undefined) return cached;

  try {
    const rows = await callFunction<RecentActivityRpcRow>('get_recent_activity', [sanitizedLimit]);

    const items: RecentActivityItem[] = rows.map((row) => ({
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
  } catch (error) {
    if (isMissingRecentActivityRpcError(error)) {
      const fallback: RecentActivityItem[] = [];
      log('Admin').warn('Recent activity RPC is unavailable; rendering an empty activity feed');
      adminCache.set(cacheKey, fallback);
      return fallback;
    }

    log('Admin').error('Error fetching recent activity:', error);
    throw new Error(
      `Failed to fetch recent activity: ${error instanceof Error ? error.message : error}`
    );
  }
}

// ─── User watches ───────────────────────────────────────────────────────────

/**
 * Get all class watches for a specific user
 */
export async function getUserWatches(userId: string): Promise<WatchWithClass[]> {
  try {
    const watches = await query<ClassWatchRow>(
      `SELECT id, user_id, class_nbr, term, subject, catalog_nbr, created_at
       FROM class_watches WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    if (watches.length === 0) {
      log('Admin').info(`No watches found for user ${userId}`);
      return [];
    }

    const classNumbers = watches.map((w) => w.class_nbr);
    const terms = Array.from(new Set(watches.map((w) => w.term)));

    const classStates = await query<ClassStateRow>(
      `SELECT id, class_nbr, term, subject, catalog_nbr, title, instructor_name,
              seats_available, seats_capacity, non_reserved_seats, location,
              meeting_times, last_checked_at, last_changed_at, consecutive_not_found_count
       FROM class_states WHERE class_nbr = ANY($1::text[]) AND term = ANY($2::text[])`,
      [classNumbers, terms]
    );

    // Key by sectionRefKey ({ class_nbr, term }) so a class_nbr watched in two
    // terms joins each watch to its own term's state instead of one overwriting
    // the other.
    const classStateMap = new Map<string, ClassStateRow>();
    for (const row of classStates) {
      // SAFETY: row is a ClassStateRow from the query; spreading + normalizing preserves the shape
      const classState = {
        ...row,
        consecutive_not_found_count: normalizeConsecutiveCount(row),
      } as ClassStateRow;
      classStateMap.set(sectionRefKey(classState), classState);
    }

    const watchesWithClass: WatchWithClass[] = watches.map((watch) => ({
      ...watch,
      class_state: classStateMap.get(sectionRefKey(watch)) || null,
    }));

    log('Admin').info(`Fetched ${watchesWithClass.length} watches for user ${userId}`);
    return watchesWithClass;
  } catch (error) {
    log('Admin').error(`Error fetching watches for user ${userId}:`, error);
    throw new Error(
      `Failed to fetch user watches: ${error instanceof Error ? error.message : error}`
    );
  }
}
