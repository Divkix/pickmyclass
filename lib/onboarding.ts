import { and, eq, isNull, sql } from 'drizzle-orm';

import type { JsonValue } from '@/lib/api/wire';
import type { Database } from '@/lib/db';
import { userProfiles } from '@/lib/db/schema';

export type OnboardingRow = {
  onboarding_completed_at: string | null;
  onboarding_skipped_at: string | null;
};

export type OnboardingState = {
  onboarding_completed_at: string | null;
  onboarding_skipped_at: string | null;
  needs_onboarding: boolean;
};

export type OnboardingPayload = OnboardingState & Record<string, JsonValue>;
export type OnboardingStatus = 'pending' | 'skipped' | 'completed';

export function onboardingStatus(row: OnboardingRow | null): OnboardingStatus {
  if (!row) return 'completed';
  if (row.onboarding_completed_at) return 'completed';
  if (row.onboarding_skipped_at) return 'skipped';
  return 'pending';
}

export function toOnboardingState(row: OnboardingRow | null): OnboardingPayload {
  const completedAt = row?.onboarding_completed_at ?? null;
  const skippedAt = row?.onboarding_skipped_at ?? null;
  return {
    onboarding_completed_at: completedAt,
    onboarding_skipped_at: skippedAt,
    needs_onboarding: onboardingStatus(row) === 'pending',
  };
}

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

export async function applyFirstWatchGuard(db: Database, userId: string): Promise<void> {
  await db
    .update(userProfiles)
    .set({ onboarding_completed_at: new Date().toISOString() })
    .where(and(eq(userProfiles.user_id, userId), isNull(userProfiles.onboarding_completed_at)));
}

export async function readOnboardingState(
  db: Database,
  userId: string
): Promise<OnboardingPayload> {
  const rows = await db
    .select({
      onboarding_completed_at: userProfiles.onboarding_completed_at,
      onboarding_skipped_at: userProfiles.onboarding_skipped_at,
    })
    .from(userProfiles)
    .where(eq(userProfiles.user_id, userId))
    .limit(1);
  return toOnboardingState(rows[0] ?? null);
}

export async function skipOnboarding(
  db: Database,
  userId: string
): Promise<OnboardingPayload | null> {
  const rows = await db.execute<OnboardingRow>(sql`SELECT * FROM skip_onboarding(${userId}::text)`);
  const row = rows[0];
  if (!row) return null;
  return toOnboardingState(row);
}
