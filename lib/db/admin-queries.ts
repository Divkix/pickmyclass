import { and, count, desc, eq, sql } from 'drizzle-orm';

import { TtlCache } from '@/lib/cache/ttl-cache';
import { ADMIN_CACHE_TTL_MS } from '@/lib/config';
import type { Database } from '@/lib/db';
import { driverErrorMessage, isUndefinedFunction } from '@/lib/db/pg-errors';
import { classStates, classWatches, notificationsSent, userProfiles } from '@/lib/db/schema';
import { log } from '@/lib/log';
import type { NotificationType } from '@/lib/types/notification';

const adminCache = new TtlCache<unknown>(ADMIN_CACHE_TTL_MS, 100);

type NotificationStatus = 'active' | 'unsubscribed' | 'bounced' | 'spam' | 'disabled';

type SortDirection = 'asc' | 'desc';
type WatchCountFilter = 'all' | 'none' | '1-5' | '6-10' | '10+';

function toIsoTimestamp(value: string): string {
  return new Date(value).toISOString();
}

type ConsecutiveCountRow = { consecutive_not_found_count?: number };

function normalizeConsecutiveCount(row: ConsecutiveCountRow): number {
  const count = row.consecutive_not_found_count;
  return typeof count === 'number' ? count : 0;
}

type CountRpcRow = { count: string };

export async function getTotalEmailsSent(db: Database): Promise<number> {
  // SAFETY: adminCache stores unknown; narrowing to number via cache key contract
  const cached = adminCache.get('total-emails-sent') as number | undefined;
  if (cached !== undefined) return cached;

  try {
    const [row] = await db.select({ value: count() }).from(notificationsSent);
    const result = Number(row?.value ?? 0);
    adminCache.set('total-emails-sent', result);
    return result;
  } catch (error) {
    log('Admin').error('Error fetching total emails sent:', error);
    throw new Error(`Failed to fetch email count: ${driverErrorMessage(error)}`);
  }
}

export async function getTotalUsers(db: Database): Promise<number> {
  // SAFETY: adminCache stores unknown; narrowing to number via cache key contract
  const cached = adminCache.get('total-users') as number | undefined;
  if (cached !== undefined) return cached;

  try {
    const [row] = await db.execute<CountRpcRow>(
      sql`SELECT public.count_all_users()::text AS count`
    );
    const result = Number(row?.count ?? 0);
    adminCache.set('total-users', result);
    return result;
  } catch (error) {
    log('Admin').error('Error counting users:', error);
    throw new Error(`Failed to count users: ${driverErrorMessage(error)}`);
  }
}

export async function getAdminCount(db: Database): Promise<number> {
  // SAFETY: adminCache stores unknown; narrowing to number via cache key contract
  const cached = adminCache.get('admin-count') as number | undefined;
  if (cached !== undefined) return cached;

  try {
    const [row] = await db
      .select({ value: count() })
      .from(userProfiles)
      .where(eq(userProfiles.is_admin, true));
    const result = Number(row?.value ?? 0);
    adminCache.set('admin-count', result);
    return result;
  } catch (error) {
    log('Admin').error('Error fetching admin count:', error);
    throw new Error(`Failed to fetch admin count: ${driverErrorMessage(error)}`);
  }
}

export async function getTotalClassesWatched(db: Database): Promise<number> {
  // SAFETY: adminCache stores unknown; narrowing to number via cache key contract
  const cached = adminCache.get('total-classes-watched') as number | undefined;
  if (cached !== undefined) return cached;

  try {
    const [row] = await db.execute<CountRpcRow>(
      sql`SELECT public.count_distinct_classes_watched()::text AS count`
    );
    const result = Number(row?.count ?? 0);
    log('Admin').info(`Counted ${result} unique classes being watched`);
    adminCache.set('total-classes-watched', result);
    return result;
  } catch (error) {
    log('Admin').error('Error counting distinct classes watched:', error);
    throw new Error(`Failed to fetch class count: ${driverErrorMessage(error)}`);
  }
}

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

type ClassState = typeof classStates.$inferSelect;
type ClassWatch = typeof classWatches.$inferSelect;

export interface ClassWithWatchers extends ClassState {
  watcher_count: number;
  seat_emails: number;
  instructor_emails: number;
}

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

interface WatchWithClass extends ClassWatch {
  class_state: ClassState | null;
}

type UsersPageRpcRow = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  watch_count: string;
  is_admin: boolean;
  seat_emails: string;
  instructor_emails: string;
  notification_status: string;
  total_count: string;
};

export async function getUsersPage(
  db: Database,
  params: GetUsersPageParams = {}
): Promise<UsersPage> {
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
    const rows = await db.execute<UsersPageRpcRow>(sql`
      SELECT *
      FROM public.get_users_page(
        ${page}::int,
        ${pageSize}::int,
        ${search}::text,
        ${role}::text,
        ${verified}::text,
        ${watchCount}::text,
        ${sort}::text,
        ${dir}::text
      )
    `);

    const mapped: UserWithWatchCount[] = rows.map((row) => ({
      id: row.id,
      email: row.email,
      created_at: toIsoTimestamp(row.created_at),
      last_sign_in_at: row.last_sign_in_at === null ? null : toIsoTimestamp(row.last_sign_in_at),
      email_confirmed_at:
        row.email_confirmed_at === null ? null : toIsoTimestamp(row.email_confirmed_at),
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
    throw new Error(`Failed to fetch users page: ${driverErrorMessage(error)}`);
  }
}

type ClassesPageRpcRow = {
  id: string;
  class_nbr: string;
  term: string;
  subject: string;
  catalog_nbr: string;
  title: string | null;
  instructor_name: string | null;
  seats_available: number;
  seats_capacity: number;
  non_reserved_seats: number | null;
  location: string | null;
  meeting_times: string | null;
  last_checked_at: string;
  last_changed_at: string;
  consecutive_not_found_count?: number;
  watcher_count: string;
  seat_emails: string;
  instructor_emails: string;
  total_count: string;
  total_watchers: string;
  full_classes: string;
};

export async function getClassesPage(
  db: Database,
  params: GetClassesPageParams = {}
): Promise<ClassesPage> {
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
    const rows = await db.execute<ClassesPageRpcRow>(sql`
      SELECT *
      FROM public.get_classes_page(
        ${page}::int,
        ${pageSize}::int,
        ${search}::text,
        ${subject}::text,
        ${seatStatus}::text,
        ${instructor}::text,
        ${watcherCount}::text,
        ${sort}::text,
        ${dir}::text
      )
    `);

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
      last_checked_at: toIsoTimestamp(row.last_checked_at),
      last_changed_at: toIsoTimestamp(row.last_changed_at),
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
    throw new Error(`Failed to fetch classes page: ${driverErrorMessage(error)}`);
  }
}

export async function getDistinctSubjects(db: Database): Promise<string[]> {
  // SAFETY: adminCache stores unknown; narrowing to string[] via cache key contract
  const cached = adminCache.get('distinct-subjects') as string[] | undefined;
  if (cached !== undefined) return cached;

  try {
    const rows = await db.execute<{ subject: string }>(
      sql`SELECT * FROM public.get_distinct_subjects()`
    );
    const result = rows.map((r) => r.subject);
    adminCache.set('distinct-subjects', result);
    return result;
  } catch (error) {
    log('Admin').error('Error fetching distinct subjects:', error);
    throw new Error(`Failed to fetch subjects: ${driverErrorMessage(error)}`);
  }
}

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

type RecentActivityRpcRow = {
  activity_type: string;
  activity_at: string;
  user_email: string;
  class_nbr: string | null;
  subject: string | null;
  catalog_nbr: string | null;
  notification_type: string | null;
};

export async function getRecentActivity(
  db: Database,
  limit: number = 50
): Promise<RecentActivityItem[]> {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new TypeError('Invalid limit: must be a finite positive integer');
  }
  const sanitizedLimit = Math.min(500, Math.max(1, Math.floor(limit)));

  const cacheKey = `recent-activity-${sanitizedLimit}`;
  // SAFETY: adminCache stores unknown; narrowing to RecentActivityItem[] via cache key contract
  const cached = adminCache.get(cacheKey) as RecentActivityItem[] | undefined;
  if (cached !== undefined) return cached;

  try {
    const rows = await db.execute<RecentActivityRpcRow>(
      sql`SELECT * FROM public.get_recent_activity(${sanitizedLimit}::int)`
    );

    const items: RecentActivityItem[] = rows.map((row) => ({
      // SAFETY: get_recent_activity RPC constrains activity_type to ActivityType union via DB check constraint
      type: row.activity_type as ActivityType,
      activityAt: toIsoTimestamp(row.activity_at),
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
    if (isUndefinedFunction(error)) {
      const fallback: RecentActivityItem[] = [];
      log('Admin').warn('Recent activity RPC is unavailable; rendering an empty activity feed');
      adminCache.set(cacheKey, fallback);
      return fallback;
    }

    log('Admin').error('Error fetching recent activity:', error);
    throw new Error(`Failed to fetch recent activity: ${driverErrorMessage(error)}`);
  }
}

export async function getUserWatches(db: Database, userId: string): Promise<WatchWithClass[]> {
  try {
    const rows = await db
      .select({ watch: classWatches, class_state: classStates })
      .from(classWatches)
      .leftJoin(
        classStates,
        and(
          eq(classWatches.class_nbr, classStates.class_nbr),
          eq(classWatches.term, classStates.term)
        )
      )
      .where(eq(classWatches.user_id, userId))
      .orderBy(desc(classWatches.created_at));

    if (rows.length === 0) {
      log('Admin').info(`No watches found for user ${userId}`);
      return [];
    }

    const watchesWithClass: WatchWithClass[] = rows.map(({ watch, class_state }) => ({
      ...watch,
      created_at: toIsoTimestamp(watch.created_at),
      class_state: class_state && {
        ...class_state,
        last_checked_at: toIsoTimestamp(class_state.last_checked_at),
        last_changed_at: toIsoTimestamp(class_state.last_changed_at),
      },
    }));

    log('Admin').info(`Fetched ${watchesWithClass.length} watches for user ${userId}`);
    return watchesWithClass;
  } catch (error) {
    log('Admin').error(`Error fetching watches for user ${userId}:`, error);
    throw new Error(`Failed to fetch user watches: ${driverErrorMessage(error)}`);
  }
}
