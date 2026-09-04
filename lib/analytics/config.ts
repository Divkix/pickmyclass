/**
 * Shared PostHog configuration constants.
 *
 * The project token is PUBLIC (shipped in the client bundle). It is not a secret —
 * the PostHog project is rate-limited / access-controlled in the PostHog UI.
 *
 * These must be real string literals (not process.env.NEXT_PUBLIC_*), because
 * client bundles only get NEXT_PUBLIC_* values that existed at *build* time.
 * Wrangler `vars` alone are runtime-only and leave the browser with
 * `init(undefined)`, which silently drops every event.
 */

export const POSTHOG_PROJECT_TOKEN = 'phc_rRbMvons2ERXqNoArYFrmJYAwTX5YnWmLsnqPgk58Wwo';

export const POSTHOG_API_HOST = 'https://s.pickmyclass.app';

export const POSTHOG_UI_HOST = 'https://us.posthog.com';
