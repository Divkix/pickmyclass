/**
 * Onboarding state shared between the dedicated `/api/user/onboarding` route and
 * the onboarding field folded into the `/api/class-watches` GET response. Keep
 * the state shape and `needs_onboarding` derivation in one place so the two
 * exposures can't drift.
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

/** ok()-compatible payload (spreads into the response envelope). */
export type OnboardingPayload = OnboardingState & Record<string, unknown>;

/**
 * Derive the onboarding state from a user_profiles row.
 *
 * A missing profile row is an anomaly (the `handle_new_user` trigger always
 * creates one); default to "not needed" so unknown users aren't bugged with a
 * first-time modal.
 */
export function toOnboardingState(row: OnboardingRow | null): OnboardingPayload {
  if (!row) {
    return {
      onboarding_completed_at: null,
      onboarding_skipped_at: null,
      needs_onboarding: false,
    };
  }
  const completedAt = row.onboarding_completed_at ?? null;
  const skippedAt = row.onboarding_skipped_at ?? null;
  return {
    onboarding_completed_at: completedAt,
    onboarding_skipped_at: skippedAt,
    needs_onboarding: completedAt === null && skippedAt === null,
  };
}
