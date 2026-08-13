/**
 * Cron route: Sync disposable email domain blocklist + daily maintenance sweeps
 *
 * Triggered daily at 4 AM UTC by Cloudflare Workers cron.
 * Runs independent phases so a failure in one never skips the others:
 *   Phase A: expire_stale_notifications() dedup sweep — never fails the job.
 *   Phase B: past-term watch deletion — never fails the job.
 *   Phase C: blocklist fetch → parse → sanity check → KV put. A failure here
 *            returns fail(...), but A and B have already run.
 */

import { env } from 'cloudflare:workers';
import { type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/auth/require-user';
import { fail, ok } from '@/lib/api/response';
import { log } from '@/lib/log';
import { getServiceClient } from '@/lib/supabase/service';
import { getPastTermCodes } from '@/lib/asu/terms';
import { deletePastTermWatches } from '@/lib/db/queries';
import type { Env } from '@/lib/types/env';

const BLOCKLIST_URL =
  'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf';

const MINIMUM_DOMAIN_COUNT = 1000;

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  // SAFETY: Cloudflare Workers env is opaque runtime value; widen to unknown before narrowing to typed Env contract.
  const rawEnv: unknown = env;
  // SAFETY: Env type reflects wrangler.jsonc bindings validated at deploy time; narrowed from unknown.
  const cfEnv = rawEnv as Env;
  try {
    // Authentication: Require CRON_SECRET Bearer token
    if (!cfEnv.CRON_SECRET) {
      log('SyncDisposableDomains').error('CRON_SECRET not configured');
      return fail('Server configuration error', 500);
    }

    if (!verifyCronSecret(request, cfEnv.CRON_SECRET)) {
      return fail('Unauthorized', 401);
    }

    // Phase A: Sweep expired notification dedup slots so they can be re-claimed on the
    // next cycle. Load-bearing — without it, users never get re-notified after 24h.
    // Independent of the blocklist sync: a failure here must not fail the job.
    try {
      const { data: expiredCount, error: sweepError } = await getServiceClient().rpc(
        'expire_stale_notifications'
      );
      if (sweepError) {
        log('SyncDisposableDomains').warn(
          'Failed to expire stale notifications:',
          sweepError.message
        );
      } else {
        log('SyncDisposableDomains').info(
          `Expired ${expiredCount ?? 0} stale notification records`
        );
      }
    } catch (error) {
      log('SyncDisposableDomains').warn(
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
        const sweptCount = await deletePastTermWatches(pastTermCodes);
        log('SyncDisposableDomains').info(`Swept ${sweptCount} past-term watches`);
      } catch (sweepWatchError) {
        log('SyncDisposableDomains').warn(
          'Failed to sweep past-term watches:',
          sweepWatchError instanceof Error ? sweepWatchError.message : sweepWatchError
        );
      }
    }

    // Phase C: Fetch blocklist from GitHub
    const response = await fetch(BLOCKLIST_URL);
    if (!response.ok) {
      return fail(`Failed to fetch blocklist: ${response.status} ${response.statusText}`, 502);
    }

    const text = await response.text();
    const domains = text
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line !== '' && !line.startsWith('#'));

    // Sanity check: prevent wiping KV on fetch errors that return empty/garbage
    if (domains.length < MINIMUM_DOMAIN_COUNT) {
      return fail(
        `Sanity check failed: only ${domains.length} domains (minimum ${MINIMUM_DOMAIN_COUNT})`,
        502
      );
    }

    // Store as single JSON blob in KV
    await cfEnv.PICKMYCLASS_DISPOSABLE_DOMAINS.put('disposable-domains', JSON.stringify(domains));

    const duration = Date.now() - startTime;
    log('SyncDisposableDomains').info(`Synced ${domains.length} domains in ${duration}ms`);

    return ok({
      domainCount: domains.length,
      duration_ms: duration,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log('SyncDisposableDomains').error('Fatal error:', message);
    return fail(message, 500, { duration_ms: Date.now() - startTime });
  }
}
