/**
 * Cron route: Sync disposable email domain blocklist
 *
 * Triggered daily at 4 AM UTC by Cloudflare Workers cron.
 * Fetches the full blocklist from GitHub, validates it, and stores
 * as a single JSON blob in KV. No diffing — just overwrite.
 */

import { getCloudflareContext } from '@opennextjs/cloudflare';
import { type NextRequest, NextResponse } from 'next/server';
import { timingSafeCompare } from '@/lib/utils/crypto';

const BLOCKLIST_URL =
  'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf';

const MINIMUM_DOMAIN_COUNT = 1000;

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Authentication: Require CRON_SECRET Bearer token
    const authHeader = request.headers.get('authorization');
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
      console.error('[SyncDisposableDomains] CRON_SECRET not configured');
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const isAuthorized =
      authHeader !== null && timingSafeCompare(authHeader, `Bearer ${expectedSecret}`);

    if (!isAuthorized) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch blocklist from GitHub
    const response = await fetch(BLOCKLIST_URL);
    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to fetch blocklist: ${response.status} ${response.statusText}`,
        },
        { status: 502 }
      );
    }

    const text = await response.text();
    const domains = text
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line !== '' && !line.startsWith('#'));

    // Sanity check: prevent wiping KV on fetch errors that return empty/garbage
    if (domains.length < MINIMUM_DOMAIN_COUNT) {
      return NextResponse.json(
        {
          success: false,
          error: `Sanity check failed: only ${domains.length} domains (minimum ${MINIMUM_DOMAIN_COUNT})`,
        },
        { status: 502 }
      );
    }

    // Store as single JSON blob in KV
    const context = await getCloudflareContext();
    const kv = (context.env as { DISPOSABLE_DOMAINS_KV: KVNamespace }).DISPOSABLE_DOMAINS_KV;

    await kv.put('disposable-domains', JSON.stringify(domains));

    const duration = Date.now() - startTime;
    console.log(`[SyncDisposableDomains] Synced ${domains.length} domains in ${duration}ms`);

    return NextResponse.json({
      success: true,
      domainCount: domains.length,
      duration_ms: duration,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SyncDisposableDomains] Fatal error:', message);
    return NextResponse.json(
      { success: false, error: message, duration_ms: Date.now() - startTime },
      { status: 500 }
    );
  }
}
