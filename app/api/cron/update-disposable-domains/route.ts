/**
 * Cron route: Sync disposable email domain blocklist
 *
 * Triggered daily at 4 AM UTC by Cloudflare Workers cron.
 * Fetches the full blocklist from GitHub, validates it, and stores
 * as a single JSON blob in KV. No diffing — just overwrite.
 */

import { env } from 'cloudflare:workers';
import { type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/auth/require-user';
import { fail, ok } from '@/lib/api/response';
import { log } from '@/lib/log';
import { getServiceClient } from '@/lib/supabase/service';

const BLOCKLIST_URL =
  'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf';

const MINIMUM_DOMAIN_COUNT = 1000;

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Authentication: Require CRON_SECRET Bearer token
    if (!process.env.CRON_SECRET) {
      log('SyncDisposableDomains').error('CRON_SECRET not configured');
      return fail('Server configuration error', 500);
    }

    if (!verifyCronSecret(request, process.env.CRON_SECRET)) {
      return fail('Unauthorized', 401);
    }

    // Fetch blocklist from GitHub
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
    const kv = (env as unknown as { PICKMYCLASS_DISPOSABLE_DOMAINS: KVNamespace })
      .PICKMYCLASS_DISPOSABLE_DOMAINS;

    await kv.put('disposable-domains', JSON.stringify(domains));

    // Sweep expired notification dedup slots so they can be re-claimed on the next cycle.
    const { data: expiredCount, error: sweepError } = await getServiceClient().rpc(
      'expire_stale_notifications'
    );
    if (sweepError) {
      log('SyncDisposableDomains').warn(
        'Failed to expire stale notifications:',
        sweepError.message
      );
    } else {
      log('SyncDisposableDomains').info(`Expired ${expiredCount ?? 0} stale notification records`);
    }

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
