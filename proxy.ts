import { type NextRequest, NextResponse } from 'next/server';
import { fail } from '@/lib/api/response';
import { type AuthorizationState, readAuthorizationState } from '@/lib/auth/authorization-state';
import { CLERK_COOKIES_TO_CLEAR, hasClerkSessionCookies } from '@/lib/auth/clerk-cookies';
import { getSessionIdentity, revokeSession } from '@/lib/auth/clerk-session';
import { decideGate, isPublicRoute } from '@/lib/auth/decide-gate';
import { getDbFromEnv } from '@/lib/db';
import { type UserVerificationState, readUserVerification } from '@/lib/db/users';
import { CLERK_CSP } from '@/lib/clerk/config';
/**
 * Build a per-request production CSP that replaces 'unsafe-inline' in
 * script-src with a cryptographic nonce. The nonce is generated fresh for
 * every request so it cannot be predicted or reused across requests.
 *
 * vinext reads the nonce directly from the content-security-policy header
 * (via getScriptNonceFromHeaderSources in app-rsc-handler.js) and applies it
 * to all framework/hydration/inline scripts automatically — no x-nonce
 * plumbing inside vinext is needed.
 *
 * We also forward the nonce as an x-nonce request header so that RSC
 * components can read it via next/headers and attach it to their own inline
 * scripts (e.g. the JSON-LD blocks in app/layout.tsx).
 *
 * Clerk CSP (manual — the Next SDK auto-injection is unavailable on vinext):
 * script-src/connect-src allow the FAPI hosts (clerk-js loads from the FAPI
 * host), connect-src allows the Cloudflare-challenge and *.protect.clerk.com
 * hosts (the trailing :* is mandatory), frame-src allows the challenge hosts
 * for bot-protection iframes, worker-src 'self' blob: for clerk-js workers.
 */
const PERMISSIONS_POLICY =
  'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=()';

const CSP_DEFAULT_SRC = "default-src 'self'";
// style-src keeps 'unsafe-inline': clerk-react injects runtime CSS-in-JS and
// next-themes' no-flash inline style also needs it. Script nonces stay strict.
const CSP_STYLE_SRC = "style-src 'self' 'unsafe-inline'";
// https: already covers https://img.clerk.com (Clerk avatars).
const CSP_IMG_SRC = "img-src 'self' data: https:";
const CSP_FONT_SRC = "font-src 'self' data:";
const CSP_CONNECT_SRC = [
  "connect-src 'self'",
  'https://analytics.divkix.me',
  'https://s.pickmyclass.app',
  ...CLERK_CSP.fapiHosts,
  ...CLERK_CSP.challengeHosts,
  ...CLERK_CSP.protectHosts,
].join(' ');
const CSP_FRAME_SRC = ['frame-src', ...CLERK_CSP.challengeHosts, "'self'"].join(' ');
const CSP_WORKER_SRC = "worker-src 'self' blob:";
const CSP_FRAME_ANCESTORS = "frame-ancestors 'none'";
const CSP_BASE_URI = "base-uri 'self'";
const CSP_FORM_ACTION = "form-action 'self'";
const CSP_NEXT_THEMES_HASH = "'sha256-jGCia7LAT8V5tk83CgiiU5FMqw9uEVddMT+0ZQDzVAM='";

function buildProductionCsp(nonce: string): string {
  return [
    CSP_DEFAULT_SRC,
    `script-src 'self' 'nonce-${nonce}' ${CSP_NEXT_THEMES_HASH} https://static.cloudflareinsights.com https://analytics.divkix.me ${CLERK_CSP.fapiHosts.join(' ')}`,
    CSP_STYLE_SRC,
    CSP_IMG_SRC,
    CSP_FONT_SRC,
    CSP_CONNECT_SRC,
    CSP_FRAME_SRC,
    CSP_WORKER_SRC,
    CSP_FRAME_ANCESTORS,
    CSP_BASE_URI,
    CSP_FORM_ACTION,
  ].join('; ');
}

const DEV_CSP = [
  CSP_DEFAULT_SRC,
  `script-src 'self' 'unsafe-eval' 'unsafe-inline' ${CLERK_CSP.fapiHosts.join(' ')}`,
  CSP_STYLE_SRC,
  CSP_IMG_SRC,
  CSP_FONT_SRC,
  CSP_CONNECT_SRC,
  CSP_FRAME_SRC,
  CSP_WORKER_SRC,
  CSP_FRAME_ANCESTORS,
  CSP_BASE_URI,
  CSP_FORM_ACTION,
].join('; ');

/**
 * Add security headers to a response.
 *
 * @param csp - The fully-formed CSP string to set. In production this is
 *   built per-request (with a nonce); in development it is the static DEV_CSP.
 */
function addSecurityHeaders(response: NextResponse, isDevelopment: boolean, csp: string): void {
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', PERMISSIONS_POLICY);
  if (!isDevelopment) {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  response.headers.set('Content-Security-Policy', csp);
}

function toRedirectUrl(request: NextRequest, to: string): URL {
  const url = request.nextUrl.clone();
  // `to` is a same-origin path that may include a query string (e.g. "/consent?next=%2Fdashboard").
  // Use URL parsing against the request origin so we correctly separate pathname/search
  // even when the query value itself contains encoded '?'/'&' characters.
  const target = new URL(to, request.url);
  url.pathname = target.pathname;
  url.search = target.search;
  return url;
}

/** Expire every Clerk session cookie on the response (belt-and-suspenders for
 * the server-side session revocation; a deleted cookie can't be replayed). */
function clearClerkCookies(response: NextResponse): void {
  for (const name of CLERK_COOKIES_TO_CLEAR) {
    response.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
}

export async function proxy(request: NextRequest) {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const pathname = request.nextUrl.pathname;
  // Early exit for public routes WITHOUT session cookies — before nonce allocation.
  // This fast-path skips crypto.randomUUID(), buildProductionCsp string building,
  // and session verification for anonymous GET to /, /faq, /about, /blog/*, /legal/*.
  const routeIsPublic = isPublicRoute(pathname);
  if (routeIsPublic && !hasClerkSessionCookies(request.cookies.getAll().map((c) => c.name))) {
    const csp = isDevelopment ? DEV_CSP : buildProductionCsp('');
    const response = NextResponse.next();
    addSecurityHeaders(response, isDevelopment, csp);
    return response;
  }

  // Generate a per-request nonce for the production CSP.
  // crypto.randomUUID() is available in both Node.js 19+ and Cloudflare Workers.
  // In development we skip the nonce (DEV_CSP keeps 'unsafe-inline' + 'unsafe-eval').
  const nonce = !isDevelopment ? crypto.randomUUID() : '';
  const csp = isDevelopment ? DEV_CSP : buildProductionCsp(nonce);

  // Build the modified request headers that forward the nonce to RSC components.
  // Using NextResponse.next({ request: { headers } }) encodes these as
  // x-middleware-request-<name> on the response, which vinext decodes and makes
  // available via headers() in Server Components (next/headers).
  // The nonce is also readable by vinext's framework layer directly from the
  // content-security-policy response header set below.
  const requestHeadersWithNonce = new Headers(request.headers);
  if (!isDevelopment) {
    requestHeadersWithNonce.set('x-nonce', nonce);
  }

  const passThrough = NextResponse.next({
    request: { headers: requestHeadersWithNonce },
  });

  // Verify the Clerk session networklessly (PEM jwtKey in-isolate). Unlike the
  // old Supabase getUser() this makes no network call on the hot path; token
  // rotation is clerk-js's job client-side, so the gate never writes cookies.
  const identity = await getSessionIdentity(request);

  // Check if accessing admin routes
  // Note: This is just a basic auth check for redirects. Real admin role verification
  // happens server-side in the actual admin pages/API routes using verifyAdmin's
  // fresh user_profiles read. Never trust middleware alone for authorization.
  // Admin routes are protected by standard auth check below (not in publicRoutes).

  // Read the cached authorization decision. The edge gate deliberately serves a
  // (up to 30s) stale decision as a CPU saver; verifyAdmin and login read fresh.
  // email_confirmed_at comes from the users mirror (Clerk webhook-synced).
  // Authenticated requests create exactly one Drizzle handle here; both gate
  // reads below share it. Anonymous requests never touch the database.
  let authState: AuthorizationState | null = null;
  let verification: UserVerificationState | null = null;
  if (identity) {
    const db = getDbFromEnv();
    authState = await readAuthorizationState(db, identity.userId, { cache: true });
    verification = await readUserVerification(db, identity.userId, { cache: true });
  }
  const decision = decideGate({
    pathname,
    search: request.nextUrl.search,
    user: identity ? { email_confirmed_at: verification?.email_confirmed_at ?? null } : null,
    authState,
  });

  let response: NextResponse;

  switch (decision.kind) {
    case 'signout-and-redirect': {
      // Disabled account: revoke the Clerk session server-side, then clear the
      // session cookies on the redirect so the JWT can't be replayed for the
      // rest of its (short) lifetime.
      if (identity?.sessionId) {
        try {
          await revokeSession(identity.sessionId);
        } catch {
          // Best-effort: cookie clearing below still signs the browser out.
        }
      }
      const url = toRedirectUrl(request, decision.to);
      response = NextResponse.redirect(url);
      clearClerkCookies(response);
      break;
    }
    case 'redirect': {
      response = NextResponse.redirect(toRedirectUrl(request, decision.to));
      break;
    }
    case 'forbidden': {
      response = fail(decision.message, 403);
      break;
    }
    case 'allow': {
      response = passThrough;
      break;
    }
  }

  addSecurityHeaders(response, isDevelopment, csp);
  return response;
}

export const middleware = proxy;
export default proxy;

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - sitemap.xml (sitemap for SEO)
     * - robots.txt (robots file for SEO)
     * - public files (public folder)
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
