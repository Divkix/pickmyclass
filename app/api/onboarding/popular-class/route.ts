import { env } from 'cloudflare:workers';
import { fail, ok } from '@/lib/api/response';
import { type ClassDetails, fetchClassFromASU } from '@/lib/asu/api';
import { requireUser, UnauthorizedError } from '@/lib/auth/require-user';
import { getMostWatchedClass } from '@/lib/db/queries';
import { log } from '@/lib/log';
import { getSelectableTerms } from '@/lib/asu/terms';
import { createClient } from '@/lib/supabase/server';

/**
 * Popular class example shown on the first step of the onboarding modal.
 *
 * Returned when the most-watched section for the current selectable term can be
 * loaded AND validated against the ASU API. Any failure (no selectable term, no
 * active watches, ASU 404 / auth / rate-limit / network error) fails open to
 * `popularClass: null` so the modal falls back to the text-only guide. We never
 * surface a stale or unvalidated section to the user.
 */
export interface PopularClass {
  class_nbr: string;
  term: string;
  details: ClassDetails;
}

/**
 * GET /api/onboarding/popular-class
 * Returns the most-watched class for the current selectable term, validated
 * against the ASU API, or `popularClass: null` when unavailable.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    await requireUser(supabase);

    const selectableTerms = getSelectableTerms();
    const currentTerm = selectableTerms[0]?.code;
    if (!currentTerm) {
      return ok({ popularClass: null });
    }

    const popular = await getMostWatchedClass(currentTerm);
    if (!popular) {
      return ok({ popularClass: null });
    }

    const asuEnv = env as unknown as { ASU_API_BASE_URL: string; ASU_API_TOKEN: string };

    let details: ClassDetails;
    try {
      details = await fetchClassFromASU(popular, asuEnv);
    } catch (error) {
      // Fail open: any ASU error (404, auth, rate limit, network) hides the
      // example and falls back to the text-only guide. Logged for observability.
      log('Onboarding').warn(
        `Popular class ${popular.class_nbr} (term ${popular.term}) failed ASU validation:`,
        error instanceof Error ? error.message : error
      );
      return ok({ popularClass: null });
    }

    return ok({ popularClass: { class_nbr: popular.class_nbr, term: popular.term, details } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail('Unauthorized', 401);
    log('Onboarding').error('Popular class error:', error);
    // Fail open on unexpected errors so onboarding never blocks.
    return ok({ popularClass: null });
  }
}
