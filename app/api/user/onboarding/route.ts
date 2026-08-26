import { log } from '@/lib/log';
import { fail, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/api/withAuth';
import { getDbFromEnv } from '@/lib/db';
import { readOnboardingState, skipOnboarding } from '@/lib/onboarding';
import { captureServerEvent } from '@/lib/analytics/server';

/**
 * GET /api/user/onboarding
 * Exposes the authenticated user's onboarding state so the dashboard can
 * decide whether to render the first-time onboarding modal / finish-setup card.
 */
export async function GET(request: Request) {
  try {
    return await withAuth(request, async (user) => {
      try {
        const payload = await readOnboardingState(getDbFromEnv(), user.userId);
        return ok(payload);
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
        const payload = await skipOnboarding(getDbFromEnv(), user.userId);

        if (!payload) {
          log('Onboarding').error('Error skipping onboarding: no result returned');
          return fail('Failed to skip onboarding', 500);
        }

        captureServerEvent(user.userId, 'onboarding_skipped', {});

        return ok(payload);
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
