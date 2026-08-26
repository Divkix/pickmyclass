/**
 * Browser analytics boundary.
 *
 * The single seam every client component uses to talk to PostHog. It forwards
 * to the bundled `module.no-external` singleton that `instrumentation-client.ts`
 * initializes at startup; before init the SDK queues/absorbs calls, and after
 * `resetAnalyticsIdentity()` a fresh anonymous identity is used.
 */

import posthog from 'posthog-js/dist/module.no-external';
import type { AnalyticsEventMap, AnalyticsProperties } from './events';

export type { AnalyticsEventMap, AnalyticsProperties };

/** Identity traits accepted by {@link identifyAnalyticsUser}. */
export type AnalyticsUserTraits = Record<string, string | number | boolean | null>;

/** Whether `instrumentation-client.ts` has finished `posthog.init()`. */
export function isAnalyticsInitialized(): boolean {
  return posthog.__loaded === true;
}

/** Capture a typed product event. No-property events pass `{}`. */
export function trackAnalyticsEvent<E extends keyof AnalyticsEventMap>(
  event: E,
  properties: AnalyticsEventMap[E]
): void {
  posthog.capture(event, properties);
}

/**
 * Bind subsequent events to an authenticated identity.
 * Pickmyclass identities use the stable app user id (`externalId ?? Clerk id`).
 */
export function identifyAnalyticsUser(userId: string, traits?: AnalyticsUserTraits): void {
  posthog.identify(userId, traits);
}

/** Forget the current identity (logout / account deletion) — starts a new anonymous one. */
export function resetAnalyticsIdentity(): void {
  posthog.reset();
}

/** Report an error to PostHog Error Tracking from any client boundary. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Error boundaries can throw any JavaScript value.
export function captureAnalyticsError(error: unknown, properties?: AnalyticsProperties): void {
  posthog.captureException(error, properties);
}
