/**
 * Hand-written row types for all database tables.
 *
 * Replaces the Supabase-generated `database.types.ts`. These types mirror the
 * vanilla-PG schema in `db/migrations/20260822000000_planetscale_schema.sql`
 * and are the single source of truth for row shapes across the app.
 */

// ─── Table rows ─────────────────────────────────────────────────────────────

export interface ClassStateRow {
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
  consecutive_not_found_count: number;
}

export interface ClassWatchRow {
  id: string;
  user_id: string;
  class_nbr: string;
  term: string;
  subject: string;
  catalog_nbr: string;
  created_at: string;
}

export interface NotificationSentRow {
  id: string;
  class_watch_id: string;
  notification_type: string;
  sent_at: string;
  expires_at: string;
  is_active: boolean;
}

export interface UserProfileRow {
  id: string;
  user_id: string;
  is_admin: boolean;
  is_disabled: boolean;
  disabled_at: string | null;
  notifications_enabled: boolean;
  unsubscribed_at: string | null;
  email_bounced: boolean;
  email_bounced_at: string | null;
  spam_complained: boolean;
  spam_complained_at: string | null;
  age_verified_at: string | null;
  agreed_to_terms_at: string | null;
  onboarding_completed_at: string | null;
  onboarding_skipped_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Local `users` mirror table — synced by Clerk webhooks (auth sibling sub-issue).
 * PK is text (Clerk user id); migrated rows are keyed by the old Supabase UUID
 * via Clerk `externalId` so existing FK data needs no remapping.
 */
export interface UserMirrorRow {
  id: string;
  /** Clerk's own user id; lets user.deleted webhooks resolve migrated rows. */
  clerk_user_id: string | null;
  email: string;
  email_confirmed_at: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

// ─── RPC return types ───────────────────────────────────────────────────────

export interface ClassWatcherRpcRow {
  user_id: string;
  email: string;
  watch_id: string;
  created_at: string;
}

export interface WatcherForSectionsRpcRow {
  user_id: string;
  email: string;
  watch_id: string;
  class_nbr: string;
}

export interface SectionRefRpcRow {
  class_nbr: string;
  term: string;
}

export interface UsersPageRpcRow {
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
}

export interface ClassesPageRpcRow {
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
  watcher_count: string;
  seat_emails: string;
  instructor_emails: string;
  total_count: string;
  total_watchers: string;
  full_classes: string;
}

export interface RecentActivityRpcRow {
  activity_type: string;
  activity_at: string;
  user_email: string;
  class_nbr: string | null;
  subject: string | null;
  catalog_nbr: string | null;
  notification_type: string | null;
}

// ─── Insert / Update helper types ───────────────────────────────────────────

export type ClassStateInsert = Omit<ClassStateRow, 'id' | 'last_changed_at'> & {
  id?: string;
  last_changed_at?: string;
};
