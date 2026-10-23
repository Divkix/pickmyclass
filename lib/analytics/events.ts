export type AnalyticsProperties = Record<string, string | number | boolean | null>;

export interface AnalyticsEventMap {
  data_exported: Record<string, never>;
  onboarding_started: Record<string, never>;
  onboarding_completed: Record<string, never>;
  user_logged_in: Record<string, never>;
  user_logged_out: Record<string, never>;
  onboarding_popular_class_tracked: { class_nbr: string; term: string };
}
