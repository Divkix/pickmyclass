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
