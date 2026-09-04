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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Error boundaries can throw any JavaScript value.
export function captureAnalyticsError(error: unknown, properties?: AnalyticsProperties): void {
  posthog.captureException(error, properties);
}
