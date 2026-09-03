/**
 * Cron route: daily maintenance sweeps
 *
 * Triggered daily at 4 AM UTC by Cloudflare Workers cron.
 * Runs independent phases so a failure in one never skips the others:
 *   Phase A: expire_stale_notifications() dedup sweep — never fails the job.
 *   Phase B: past-term watch deletion — never fails the job.
 */

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
  // SAFETY: Cloudflare Workers env is opaque runtime value; widen to unknown before narrowing to typed Env contract.
  const rawEnv: unknown = env;
  // SAFETY: Env type reflects wrangler.jsonc bindings validated at deploy time; narrowed from unknown.
  const cfEnv = rawEnv as Env;
  try {
    // Authentication: shared cron gate (500 when unconfigured, 401 when unauthorized)
    const cronAuth = requireCronAuth(request, cfEnv.CRON_SECRET);
    if (cronAuth) {
      if (cronAuth.status === 500) log('Maintenance').error('CRON_SECRET not configured');
      return cronAuth;
    }

    // One request-scoped Drizzle handle shared by both phases below.
    const db = getDbFromEnv();

    // Phase A: Sweep expired notification dedup slots so they can be re-claimed on the
    // next cycle. Load-bearing — without it, users never get re-notified after 24h.
    // A failure here must not fail the daily job.
    try {
      // SECURITY DEFINER RPC returning INTEGER; postgres.js may deliver the
      // scalar as number or string depending on type fetching, so normalize
      // once here (missing row or NULL counts as 0, matching the old seam).
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

    // Phase B: Hard-delete watches whose term has ended (e.g. a student forgot to remove a
    // last-semester section). Cascade removes their notifications_sent rows. Silent —
    // a past-term watch can never become useful again. Layer 1 (cron enqueue filter)
    // already stops these from being processed; this clears the stale rows. A failure
    // here must not fail the daily job, so log and swallow.
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
