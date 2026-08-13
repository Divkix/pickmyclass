import { PostHog } from 'posthog-node';
import { POSTHOG_API_HOST, POSTHOG_PROJECT_TOKEN } from '@/lib/posthog/config';
import { log } from '@/lib/log';

type PostHogProperties = Record<string, string | number | boolean | null | undefined>;

interface ServerEvent {
  distinctId: string;
  event: string;
  properties?: PostHogProperties;
  identify?: PostHogProperties;
}

let client: PostHog | null = null;

export function getPostHogClient(): PostHog {
  client ??= new PostHog(POSTHOG_PROJECT_TOKEN, {
    disabled: process.env.NODE_ENV === 'test',
    fetchRetryCount: 0,
    flushAt: 1,
    flushInterval: 0,
    host: POSTHOG_API_HOST,
    requestTimeout: 1_000,
  });
  return client;
}

/**
 * Capture analytics without allowing an observability outage to fail the
 * application operation that produced the event.
 */
export async function captureServerEvent(input: ServerEvent): Promise<void> {
  try {
    const posthog = getPostHogClient();
    const { distinctId, event, properties, identify } = input;

    posthog.capture({ distinctId, event, properties });
    if (identify) {
      posthog.identify({ distinctId, properties: identify });
    }
    await posthog.flush();
  } catch (error) {
    log('PostHog').warn('Failed to flush analytics event:', error);
  }
}
