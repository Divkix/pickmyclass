/**
 * Build-time PostHog source-map upload is opt-in and fail-open.
 *
 * The deploy script sets POSTHOG_UPLOAD_SOURCEMAPS=true, but Cloudflare Workers
 * Builds uses that same script without POSTHOG_API_KEY / POSTHOG_PROJECT_ID.
 * Missing credentials skip the plugin so the Worker still deploys; upload runs
 * only when both the flag and personal API credentials are present.
 */
export function shouldUploadPosthogSourcemaps(
  uploadRequested: boolean,
  apiKey: string | undefined,
  projectId: string | undefined
): boolean {
  return uploadRequested && Boolean(apiKey) && Boolean(projectId);
}
