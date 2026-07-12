import { requireUser, UnauthorizedError } from '@/lib/auth/require-user';
import { log } from '@/lib/log';
import { fail, ok } from '@/lib/api/response';
import { toOnboardingState, type OnboardingRow } from '@/lib/onboarding';
import { getPostHogClient } from '@/lib/posthog-server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/user/onboarding
 * Exposes the authenticated user's onboarding state so the dashboard can
 * decide whether to render the first-time onboarding modal / finish-setup card.
 */
export async function GET() {
  try {
    const supabase = await createClient();

    let user: Awaited<ReturnType<typeof requireUser>>['user'];
    try {
      ({ user } = await requireUser(supabase));
    } catch (e) {
      if (e instanceof UnauthorizedError) return fail('Unauthorized', 401);
      throw e;
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .select('onboarding_completed_at, onboarding_skipped_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      log('Onboarding').error('Error reading onboarding state:', error);
      return fail('Failed to load onboarding state', 500);
    }

    return ok(toOnboardingState(data as OnboardingRow | null));
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
export async function POST() {
  try {
    const supabase = await createClient();

    let user: Awaited<ReturnType<typeof requireUser>>['user'];
    try {
      ({ user } = await requireUser(supabase));
    } catch (e) {
      if (e instanceof UnauthorizedError) return fail('Unauthorized', 401);
      throw e;
    }

    const { data, error } = await supabase.rpc('skip_onboarding');

    if (error) {
      log('Onboarding').error('Error skipping onboarding:', error);
      return fail('Failed to skip onboarding', 500);
    }

    const row = (data as OnboardingRow[] | null)?.[0] ?? null;

    const posthog = getPostHogClient();
    posthog.capture({ distinctId: user.id, event: 'onboarding_skipped' });
    await posthog.shutdown();

    return ok(toOnboardingState(row));
  } catch (error) {
    log('Onboarding').error('Skip onboarding error:', error);
    return fail('Failed to skip onboarding', 500);
  }
}
