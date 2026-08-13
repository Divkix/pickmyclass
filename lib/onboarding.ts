/**
 * Onboarding lifecycle: the single owner of onboarding state, projections, and
 * transition rules. Routes and components are transport/view adapters; the
 * rules live here so the skip route, watch creation, modal, and dashboard share
 * one behavior (ADR 0010).
 *
 * This module is browser-safe (no server-only imports). Persistence is performed
 * by the routes via Supabase; this module only decides *whether* a transition
 * applies and projects the resulting state.
 *
 * Transition matrix:
 *   pending  --skip-->      skipped
 *   pending  --first watch--> completed
 *   skipped  --first watch--> completed   (ADR 0010: first watch completes, even after skip)
 *   completed              (terminal)
 */

export interface OnboardingRow {
  onboarding_completed_at: string | null;
  onboarding_skipped_at: string | null;
}

export interface OnboardingState {
  onboarding_completed_at: string | null;
  onboarding_skipped_at: string | null;
  needs_onboarding: boolean;
}
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** ok()-compatible payload (spreads into the response envelope). */
export type OnboardingPayload = OnboardingState & Record<string, JsonValue>;
/** The three lifecycle states a user can be in. */
export type OnboardingStatus = 'pending' | 'skipped' | 'completed';

/**
 * Derive the lifecycle status from a profile row (or any state shape carrying
 * the two timestamps). A missing profile row is an anomaly (the `handle_new_user`
 * trigger always creates one); treat it as `completed` so unknown users aren't
 * bugged with a first-time modal.
 */
export function onboardingStatus(row: OnboardingRow | null): OnboardingStatus {
  if (!row) return 'completed';
  if (row.onboarding_completed_at) return 'completed';
  if (row.onboarding_skipped_at) return 'skipped';
  return 'pending';
}

/**
 * Derive the onboarding state from a user_profiles row.
 *
 * A missing profile row is an anomaly (the `handle_new_user` trigger always
 * creates one); default to "not needed" so unknown users aren't bugged with a
 * first-time modal.
 */
export function toOnboardingState(row: OnboardingRow | null): OnboardingPayload {
  const completedAt = row?.onboarding_completed_at ?? null;
  const skippedAt = row?.onboarding_skipped_at ?? null;
  return {
    onboarding_completed_at: completedAt,
    onboarding_skipped_at: skippedAt,
    needs_onboarding: onboardingStatus(row) === 'pending',
  };
}

/**
 * Project the onboarding state after the user creates their first watch.
 * Applies the `pending -> completed` and `skipped -> completed` transitions
 * (ADR 0010: first watch anywhere completes onboarding, including after skip).
 * A `completed` user is a no-op. The `skipped_at` timestamp is preserved so the
 * projection matches the server, which only sets `completed_at` and leaves
 * `skipped_at` untouched.
 */
export function completeOnFirstWatch(
  current: OnboardingState,
  now: string = new Date().toISOString()
): OnboardingPayload {
  if (onboardingStatus(current) === 'completed') {
    return { ...current };
  }
  return {
    onboarding_completed_at: now,
    onboarding_skipped_at: current.onboarding_skipped_at,
    needs_onboarding: false,
  };
}

/**
 * DB-level enforcement of the first-watch completion rule, applied to a
 * Supabase `user_profiles` update chain (the builder after `.eq('user_id', ...)`).
 *
 * Only `onboarding_completed_at IS NULL` is guarded, so a skipped user
 * (`skipped_at` set, `completed_at` null) still transitions to completed. This
 * is the persistence-side twin of `completeOnFirstWatch`: the row set matched by
 * `completed_at IS NULL` is exactly pending-or-skipped, i.e. "not completed".
 */
export function applyFirstWatchGuard<T extends { is: (column: string, value: null) => T }>(
  query: T
): T {
  return query.is('onboarding_completed_at', null);
}
