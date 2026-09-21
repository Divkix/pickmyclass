import posthog from 'posthog-js/dist/module.no-external';
import type { AnalyticsEventMap, AnalyticsProperties } from './events';

export type { AnalyticsEventMap, AnalyticsProperties };

export type AnalyticsUserTraits = Record<string, string | number | boolean | null>;

export function trackAnalyticsEvent<E extends keyof AnalyticsEventMap>(
  event: E,
  properties: AnalyticsEventMap[E]
): void {
  posthog.capture(event, properties);
}

export function identifyAnalyticsUser(userId: string, traits?: AnalyticsUserTraits): void {
  posthog.identify(userId, traits);
}

export function resetAnalyticsIdentity(): void {
  posthog.reset();
}

// Error boundaries can throw any JavaScript value; `cause` is the caught value.
export function captureAnalyticsError(cause: unknown, properties?: AnalyticsProperties): void {
  posthog.captureException(cause, properties);
}
