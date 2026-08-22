import { callFunction, queryOne } from '@/lib/db/client';
import type { SkipOnboardingRpcRow } from '@/lib/db/types';
import { log } from '@/lib/log';
import { fail, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/api/withAuth';
import { toOnboardingState, type OnboardingRow } from '@/lib/onboarding';
import { captureServerEvent } from '@/lib/posthog-server';

/**
 * GET /api/user/onboarding
 * Exposes the authenticated user's onboarding state so the dashboard can
 * decide whether to render the first-time onboarding modal / finish-setup card.
 */
export async function GET(request: Request) {
  try {
    return await withAuth(request, async (user) => {
      try {
        const data = await queryOne<{
          onboarding_completed_at: string | null;
          onboarding_skipped_at: string | null;
        }>(
          `SELECT onboarding_completed_at, onboarding_skipped_at
           FROM user_profiles WHERE user_id = $1`,
          [user.userId]
        );

        // SAFETY: data is the result of queryOne selecting onboarding columns; null or shape matches OnboardingRow by DB contract
        return ok(toOnboardingState(data as OnboardingRow | null));
      } catch (error) {
        log('Onboarding').error('Get onboarding state error:', error);
        return fail('Failed to load onboarding state', 500);
      }
    });
  } catch (error) {
    log('Onboarding').error('Get onboarding state error:', error);
    return fail('Failed to load onboarding state', 500);
  }
}

/**
 * POST /api/user/onboarding
 * Marks onboarding as skipped (Escape / backdrop / Skip button). No-ops if the
 * user already completed or skipped onboarding. Returns the resulting state.
 */
export async function POST(request: Request) {
  try {
    return await withAuth(request, async (user) => {
      try {
        const rows = await callFunction<SkipOnboardingRpcRow>('skip_onboarding', [user.userId]);

        // SAFETY: rows is the array returned by skip_onboarding RPC; first element matches OnboardingRow by DB contract
        const row = rows[0] ?? null;

        if (!row) {
          log('Onboarding').error('Error skipping onboarding: no result returned');
          return fail('Failed to skip onboarding', 500);
        }

        await captureServerEvent({ distinctId: user.userId, event: 'onboarding_skipped' });

        // SAFETY: row is the first element returned by skip_onboarding RPC; shape matches OnboardingRow by DB contract
        return ok(toOnboardingState(row as OnboardingRow));
      } catch (error) {
        log('Onboarding').error('Skip onboarding error:', error);
        return fail('Failed to skip onboarding', 500);
      }
    });
  } catch (error) {
    log('Onboarding').error('Skip onboarding error:', error);
    return fail('Failed to skip onboarding', 500);
  }
}
