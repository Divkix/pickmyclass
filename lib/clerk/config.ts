/**
 * Shared Clerk configuration constants.
 *
 * The publishable key is PUBLIC (shipped in the client bundle, like the old
 * Supabase anon key). It is not a secret — the Clerk instance is rate-limited
 * and access-controlled in the Clerk dashboard.
 *
 * Keep this public key literal so browser builds need no environment setup.
 * Vite can inline import.meta.env.VITE_* values at build time; Wrangler `vars`
 * alone are runtime-only and cannot supply a browser publishable key.
 */
export const CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsucGlja215Y2xhc3MuYXBwJA";

/**
 * Hosts Clerk's client-side script (clerk-js) may load from, for CSP script-src.
 * Clerk's React SDK loads clerk-js from the instance's Frontend API (FAPI) host by
 * default: *.clerk.accounts.dev in development, the custom FAPI domain in prod.
 */
export const CLERK_CSP = {
  /** FAPI hosts for script-src and connect-src. */
  fapiHosts: ["https://*.clerk.accounts.dev", "https://clerk.pickmyclass.app"],
  /**
   * Cloudflare Turnstile. Sign-up loads this as a script
   * (`/turnstile/v0/api.js`) and as a frame. Required on script-src,
   * connect-src, and frame-src — connect/frame alone still blocks the script.
   */
  challengeHosts: ["https://challenges.cloudflare.com"],
  /**
   * Clerk abuse/fraud hosts for script-src and frame-src. connect-src must
   * use {@link protectConnectHosts}: these hosts are not on 443, and a CSP
   * source with no port matches port 443 only.
   */
  protectHosts: ["https://*.protect.clerk.com"],
  /** connect-src only. The trailing `:*` is required. */
  protectConnectHosts: ["https://*.protect.clerk.com:*"],
} as const;
