export type AnalyticsProperties = Record<string, string | number | boolean | null>;

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
