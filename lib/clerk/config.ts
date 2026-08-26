/**
 * Shared Clerk configuration constants.
 *
 * The publishable key is PUBLIC (shipped in the client bundle, like the old
 * Supabase anon key). It is not a secret — the Clerk instance is rate-limited
 * and access-controlled in the Clerk dashboard.
 *
 * This must be a real string literal (not process.env.NEXT_PUBLIC_*), because
 * client bundles only get NEXT_PUBLIC_* values that existed at *build* time.
 * Wrangler `vars` alone are runtime-only and would leave the browser with
 * `ClerkProvider publishableKey={undefined}` (same trap as PostHog — see
 * lib/analytics/config.ts).
 *
 * OWNER ACTION REQUIRED (#351 cutover): replace the placeholder with the real
 * publishable key from the Clerk dashboard (starts with pk_live_ / pk_test_).
 * Until then every Clerk call fails fast with an invalid-key error, which is
 * deliberate — a loud failure beats silently pointing at a nonexistent instance.
 */
export const CLERK_PUBLISHABLE_KEY = 'pk_live_Y2xlcmsucGlja215Y2xhc3MuYXBwJA';

/**
 * Hosts Clerk's client-side script (clerk-js) may load from, for CSP script-src.
 * clerk-react loads clerk-js from the instance's Frontend API (FAPI) host by
 * default: *.clerk.accounts.dev in development, the custom FAPI domain in prod.
 */
export const CLERK_CSP = {
  /** FAPI hosts for script-src and connect-src. */
  fapiHosts: ['https://*.clerk.accounts.dev', 'https://clerk.pickmyclass.app'],
  /** Bot-protection + payment-fraud challenge hosts (connect/frame). */
  challengeHosts: ['https://challenges.cloudflare.com'],
  /** Clerk device-integrity hosts. The trailing :* is REQUIRED in connect-src. */
  protectHosts: ['https://*.protect.clerk.com:*'],
  /** Clerk avatar/image host for img-src. */
  imgHosts: ['https://img.clerk.com'],
} as const;
