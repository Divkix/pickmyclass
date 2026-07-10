import { PostHog } from 'posthog-node';
import { POSTHOG_API_HOST, POSTHOG_PROJECT_TOKEN } from '@/lib/posthog/config';

export function getPostHogClient(): PostHog {
  return new PostHog(POSTHOG_PROJECT_TOKEN, {
    host: POSTHOG_API_HOST,
    flushAt: 1,
    flushInterval: 0,
  });
}
