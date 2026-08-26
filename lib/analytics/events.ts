/**
 * Typed analytics event catalog.
 *
 * `AnalyticsEventMap` is the single source of truth for every product event
 * Pickmyclass emits: the browser client (`lib/analytics/client.ts`) and the
 * server client (`lib/analytics/server.ts`) both type their capture functions
 * against it, so an unknown event name or a mismatched property payload is a
 * compile error instead of a silently dropped PostHog event.
 */

/** Property payloads must stay JSON-flat so PostHog ingestion never drops them. */
export type AnalyticsProperties = Record<string, string | number | boolean | null>;

/**
 * Every product event, keyed by its PostHog event name.
 * No-property events use `Record<string, never>` and are captured with `{}`.
 */
export interface AnalyticsEventMap {
  class_watch_created: { term: string; class_nbr: string };
  class_watch_deleted: { watch_id: string };
  user_unsubscribed: Record<string, never>;
  account_deleted: Record<string, never>;
  onboarding_skipped: Record<string, never>;
  data_exported: Record<string, never>;
  onboarding_started: Record<string, never>;
  onboarding_completed: Record<string, never>;
  user_logged_out: Record<string, never>;
  onboarding_popular_class_tracked: { class_nbr: string; term: string };
}
