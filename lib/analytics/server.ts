/**
 * Server-side analytics boundary.
 *
 * Every send constructs a FRESH PostHog client (flushAt 1 / flushInterval 0 /
 * no retries / 1s timeout) so a Workers isolate never keeps sockets, retry
 * timers, or feature-flag pollers alive between requests. Events are
 * fire-and-forget: the flush/shutdown promise is registered with `waitUntil`
 * so analytics outages can never fail the product request that emitted them.
 *
 * Identity rule: server routes already resolve the stable app user id
 * (`externalId ?? Clerk id`, the `ext_id` session claim) — pass it as `distinctId`.
 */

import { waitUntil } from 'cloudflare:workers';
import { PostHog } from 'posthog-node';
import { log } from '@/lib/log';
import { POSTHOG_API_HOST, POSTHOG_PROJECT_TOKEN } from './config';
import type { AnalyticsEventMap, AnalyticsProperties } from './events';

const SHUTDOWN_TIMEOUT_MS = 1_000;

function createClient(): PostHog {
  return new PostHog(POSTHOG_PROJECT_TOKEN, {
    host: POSTHOG_API_HOST,
    flushAt: 1,
    flushInterval: 0,
    fetchRetryCount: 0,
    requestTimeout: SHUTDOWN_TIMEOUT_MS,
  });
}

export function captureServerEvent<E extends keyof AnalyticsEventMap>(
  distinctId: string,
  event: E,
  properties: AnalyticsEventMap[E]
): void {
  const client = createClient();
  waitUntil(
    client
      .captureImmediate({ distinctId, event, properties })
      .catch((error) => {
        log('Analytics').warn('Failed to send analytics event:', error);
      })
      .finally(() => client.shutdown(SHUTDOWN_TIMEOUT_MS))
  );
}

// Server instrumentation receives arbitrary thrown JavaScript values by contract.
// oxlint-disable anti-slop/no-unknown-parameters
export async function captureServerException(
  error: unknown,
  properties?: AnalyticsProperties
): Promise<void> {
  const client = createClient();
  try {
    // SAFETY: metadata must occupy the third slot — the second is the optional distinct id.
    await client.captureExceptionImmediate(error, undefined, properties);
  } catch (sendError) {
    log('Analytics').warn('Failed to send analytics exception:', sendError);
  } finally {
    await client.shutdown(SHUTDOWN_TIMEOUT_MS);
  }
}
// oxlint-enable anti-slop/no-unknown-parameters
