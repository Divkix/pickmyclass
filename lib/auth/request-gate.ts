import { isRedirect } from "@tanstack/react-router";
import { fail } from "@/lib/api/response";
import { type AuthorizationState, readAuthorizationState } from "@/lib/auth/authorization-state";
import { clearClerkCookies, hasClerkSessionCookiesInHeader } from "@/lib/auth/clerk-cookies";
import { type SessionIdentity, revokeSession } from "@/lib/auth/clerk-session";
import { type GateDecision, decideGate, isPublicRoute } from "@/lib/auth/decide-gate";
import { CLERK_CSP } from "@/lib/clerk/config";
import { getDbFromEnv } from "@/lib/db";
import { type UserVerificationState, readUserVerification } from "@/lib/db/users";
import { errorFields, log } from "@/lib/log";

// Clerk CSP (configured by hand; the Clerk SDK does not set one):
// script-src allows the FAPI host plus Turnstile and *.protect.clerk.com
// (sign-up loads challenges.cloudflare.com/turnstile/v0/api.js; omitting it
// from script-src fails every signup with captcha_invalid). connect-src uses
// the protect host with a trailing :* (those hosts are not on 443). frame-src
// allows the Turnstile and protect hosts. worker-src is 'self' blob:.
const PERMISSIONS_POLICY =
  "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=()";

const CSP_DEFAULT_SRC = "default-src 'self'";

// style-src keeps 'unsafe-inline': Clerk's React components inject runtime CSS-in-JS and
// next-themes' no-flash inline style also needs it. Script nonces stay strict.
const CSP_STYLE_SRC = "style-src 'self' 'unsafe-inline'";

// https: already covers https://img.clerk.com (Clerk avatars).
const CSP_IMG_SRC = "img-src 'self' data: https:";

const CSP_FONT_SRC = "font-src 'self' data:";

const CSP_CONNECT_SRC = [
  "connect-src 'self'",
  "https://analytics.divkix.me",
  ...CLERK_CSP.fapiHosts,
  ...CLERK_CSP.challengeHosts,
  ...CLERK_CSP.protectConnectHosts,
].join(" ");

const CSP_CLERK_SCRIPT_HOSTS = [
  ...CLERK_CSP.fapiHosts,
  ...CLERK_CSP.challengeHosts,
  ...CLERK_CSP.protectHosts,
].join(" ");

const CSP_FRAME_SRC = [
  "frame-src",
  ...CLERK_CSP.challengeHosts,
  ...CLERK_CSP.protectHosts,
  "'self'",
].join(" ");

const CSP_WORKER_SRC = "worker-src 'self' blob:";

const CSP_FRAME_ANCESTORS = "frame-ancestors 'none'";

const CSP_BASE_URI = "base-uri 'self'";

const CSP_FORM_ACTION = "form-action 'self'";

const LEGACY_REDIRECTS = new Map([
  ["/faq/page", "/faq"],
  ["/register", "/sign-up"],
  ["/login", "/sign-in"],
]);

// Machine-read files and images skip the gate. Static assets never reach the
// Worker; these are the routes that render them.
const GATE_EXEMPT =
  /^\/(?:favicon\.ico|sitemap\.xml|robots\.txt|llms\.txt|llms-full\.txt)$|\.(?:svg|png|jpg|jpeg|gif|webp)$/;

export function isGateExempt(pathname: string): boolean {
  return GATE_EXEMPT.test(pathname);
}

// 'wasm-unsafe-eval' allows WebAssembly compilation only, never JS eval: the
// lazily loaded telemetry SDK (long.js under protobufjs) probes for it, and a
// blocked probe is reported as a CSP violation.
function buildProductionCsp(inlineScriptSource: string): string {
  return [
    CSP_DEFAULT_SRC,
    `script-src 'self' ${inlineScriptSource} 'wasm-unsafe-eval' https://analytics.divkix.me ${CSP_CLERK_SCRIPT_HOSTS}`,
    CSP_STYLE_SRC,
    CSP_IMG_SRC,
    CSP_FONT_SRC,
    CSP_CONNECT_SRC,
    CSP_FRAME_SRC,
    CSP_WORKER_SRC,
    CSP_FRAME_ANCESTORS,
    CSP_BASE_URI,
    CSP_FORM_ACTION,
  ].join("; ");
}

// Session-less public pages are edge-cached and replayed to every visitor, so
// they cannot have a per-request nonce. They allow inline scripts instead.
// Never put a nonce or hash beside 'unsafe-inline': browsers then ignore it,
// and an empty 'nonce-' here once blocked the framework's inline bootstrap and
// blanked the homepage for anonymous visitors and Googlebot's renderer.
const PUBLIC_CSP = buildProductionCsp("'unsafe-inline'");

const DEV_CSP = [
  CSP_DEFAULT_SRC,
  `script-src 'self' 'unsafe-eval' 'unsafe-inline' ${CSP_CLERK_SCRIPT_HOSTS}`,
  CSP_STYLE_SRC,
  CSP_IMG_SRC,
  CSP_FONT_SRC,
  CSP_CONNECT_SRC,
  CSP_FRAME_SRC,
  CSP_WORKER_SRC,
  CSP_FRAME_ANCESTORS,
  CSP_BASE_URI,
  CSP_FORM_ACTION,
].join("; ");

function setSecurityHeaders(headers: Headers, csp: string): void {
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", PERMISSIONS_POLICY);

  if (process.env.NODE_ENV !== "development") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  headers.set("Content-Security-Policy", csp);
}

// Pages, handlers and server functions render per request (session, nonce, user data), so a
// response that may be cached sets its own header. The edge HTML cache restamps the copy it stores.
const PER_REQUEST_CACHE_CONTROL = "private, no-cache, no-store, max-age=0, must-revalidate";

function setDefaultCacheControl(headers: Headers): void {
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", PER_REQUEST_CACHE_CONTROL);
}

/**
 * The response to add headers to. Most are copied, since a response's headers can be immutable.
 * A router redirect is kept as-is: Start serializes a server function's redirect for the client
 * router only while it is the router's own object, and its headers are always writable.
 */
function writableResponse(response: Response): Response {
  return isRedirect(response) ? response : new Response(response.body, response);
}

/** The app's response with the gate's security headers. */
export function withSecurityHeaders(response: Response, csp: string): Response {
  const secured = writableResponse(response);
  setSecurityHeaders(secured.headers, csp);
  setDefaultCacheControl(secured.headers);

  return secured;
}

/** For responses that skip the gate: server functions and machine-read files. */
export function withDefaultCacheControl(response: Response): Response {
  if (response.headers.has("Cache-Control")) return response;

  const copy = writableResponse(response);
  setDefaultCacheControl(copy.headers);

  return copy;
}

function redirectTo(request: Request, to: string, status = 307): Response {
  return new Response(null, { status, headers: { Location: new URL(to, request.url).href } });
}

/** Best effort: the redirect clears the cookies either way; a live session is worth a trace. */
export async function revokeSessionQuietly(identity: SessionIdentity | null): Promise<void> {
  if (!identity?.sessionId) return;

  try {
    await revokeSession(identity.sessionId);
  } catch (error) {
    log("Gate").warn("Failed to revoke Clerk session while signing out", errorFields(error));
  }
}

/** What `decideGate` says about `pathname` for `identity`. */
export async function evaluateGate(
  pathname: string,
  search: string,
  identity: SessionIdentity | null,
): Promise<GateDecision> {
  let authState: AuthorizationState | null = null;
  let verification: UserVerificationState | null = null;

  if (identity) {
    const db = getDbFromEnv();
    [authState, verification] = await Promise.all([
      readAuthorizationState(db, identity.userId, { cache: true }),
      readUserVerification(db, identity.userId, { cache: true }),
    ]);
  }

  return decideGate({
    pathname,
    search,
    user: identity ? { email_confirmed_at: verification?.email_confirmed_at ?? null } : null,
    authState,
  });
}

export type GateOutcome =
  | { kind: "respond"; response: Response }
  | { kind: "render"; nonce: string | undefined; csp: string };

/**
 * The edge gate for every page and server-route request: legacy redirects,
 * auth/consent routing and the CSP. `render` outcomes carry the nonce the
 * framework stamps on its inline scripts and the CSP for the rendered response.
 */
export async function gateRequest(
  request: Request,
  identity: SessionIdentity | null,
): Promise<GateOutcome> {
  const url = new URL(request.url);
  const legacyDestination = LEGACY_REDIRECTS.get(url.pathname);

  if (legacyDestination) {
    return { kind: "respond", response: redirectTo(request, legacyDestination + url.search, 301) };
  }

  const isDevelopment = process.env.NODE_ENV === "development";

  if (
    isPublicRoute(url.pathname) &&
    !hasClerkSessionCookiesInHeader(request.headers.get("cookie"))
  ) {
    return { kind: "render", nonce: undefined, csp: isDevelopment ? DEV_CSP : PUBLIC_CSP };
  }

  // crypto.randomUUID() exists in Node.js 19+ and Workers.
  const nonce = isDevelopment ? undefined : crypto.randomUUID();
  const csp = nonce ? buildProductionCsp(`'nonce-${nonce}'`) : DEV_CSP;
  const decision = await evaluateGate(url.pathname, url.search, identity);

  switch (decision.kind) {
    case "signout-and-redirect": {
      await revokeSessionQuietly(identity);
      const response = redirectTo(request, decision.to);
      clearClerkCookies(response.headers, request.headers.get("cookie"));
      setSecurityHeaders(response.headers, csp);

      return { kind: "respond", response };
    }

    case "redirect": {
      const response = redirectTo(request, decision.to);
      setSecurityHeaders(response.headers, csp);

      return { kind: "respond", response };
    }

    case "forbidden": {
      const response = fail(decision.message, 403);
      setSecurityHeaders(response.headers, csp);

      return { kind: "respond", response };
    }

    case "allow":
      return { kind: "render", nonce, csp };
  }
}
