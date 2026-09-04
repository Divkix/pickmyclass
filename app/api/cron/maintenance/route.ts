import { env } from 'cloudflare:workers';
import { sql } from 'drizzle-orm';
import { type NextRequest } from 'next/server';
import { requireCronAuth } from '@/lib/auth/require-user';
import { getDbFromEnv } from '@/lib/db';
import { fail, ok } from '@/lib/api/response';
import { log } from '@/lib/log';
import { getPastTermCodes } from '@/lib/asu/terms';
import { deletePastTermWatches } from '@/lib/db/queries';
import type { Env } from '@/lib/types/env';

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const rawEnv: unknown = env;
  // SAFETY: Env reflects wrangler.jsonc bindings validated at deploy; narrowed from unknown
  const cfEnv = rawEnv as Env;
  try {
    const cronAuth = requireCronAuth(request, cfEnv.CRON_SECRET);
    if (cronAuth) {
      if (cronAuth.status === 500) log('Maintenance').error('CRON_SECRET not configured');
      return cronAuth;
    }

    const db = getDbFromEnv();

    try {
      const rows = await db.execute<{ expired: unknown }>(
        sql`SELECT public.expire_stale_notifications() AS expired`
      );
      const expiredCount = Number(rows[0]?.expired ?? 0);
      log('Maintenance').info(`Expired ${expiredCount} stale notification records`);
    } catch (error) {
      log('Maintenance').warn(
        'Failed to expire stale notifications:',
        error instanceof Error ? error.message : error
      );
    }

    const pastTermCodes = getPastTermCodes();
    if (pastTermCodes.length > 0) {
      try {
        const sweptCount = await deletePastTermWatches(db, pastTermCodes);
        log('Maintenance').info(`Swept ${sweptCount} past-term watches`);
      } catch (sweepWatchError) {
        log('Maintenance').warn(
          'Failed to sweep past-term watches:',
          sweepWatchError instanceof Error ? sweepWatchError.message : sweepWatchError
        );
      }
    }

    return ok({
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log('Maintenance').error('Fatal error:', message);
    return fail(message, 500, { duration_ms: Date.now() - startTime });
  }
}
