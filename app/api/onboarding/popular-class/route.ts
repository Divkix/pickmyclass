import { env } from 'cloudflare:workers';
import { fail, ok } from '@/lib/api/response';
import { type ClassDetails, fetchClassFromASU } from '@/lib/asu/api';
import { requireUser, UnauthorizedError } from '@/lib/auth/require-user';
import { getDbFromEnv } from '@/lib/db';
import { getMostWatchedClass } from '@/lib/db/queries';
import { log } from '@/lib/log';
import { getSelectableTerms } from '@/lib/asu/terms';

export interface PopularClass {
  [key: string]: string | ClassDetails;
  class_nbr: string;
  term: string;
  details: ClassDetails;
}
export async function GET(request: Request) {
  try {
    await requireUser(request);

    const selectableTerms = getSelectableTerms();
    const currentTerm = selectableTerms[0]?.code;
    if (!currentTerm) {
      return ok({ popularClass: null });
    }

    const popular = await getMostWatchedClass(getDbFromEnv(), currentTerm);
    if (!popular) {
      return ok({ popularClass: null });
    }

    // SAFETY: ASU base URL and token are required secrets validated at deploy
    const asuEnv = env as { ASU_API_BASE_URL: string; ASU_API_TOKEN: string };

    let details: ClassDetails;
    try {
      details = await fetchClassFromASU(popular, asuEnv);
    } catch (error) {
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
    return ok({ popularClass: null });
  }
}
