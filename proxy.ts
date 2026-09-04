import { type NextRequest, NextResponse } from 'next/server';
import { fail } from '@/lib/api/response';
import { type AuthorizationState, readAuthorizationState } from '@/lib/auth/authorization-state';
import { CLERK_COOKIES_TO_CLEAR, hasClerkSessionCookies } from '@/lib/auth/clerk-cookies';
import { getSessionIdentity, revokeSession } from '@/lib/auth/clerk-session';
import { decideGate, isPublicRoute } from '@/lib/auth/decide-gate';
import { getDbFromEnv } from '@/lib/db';
import { type UserVerificationState, readUserVerification } from '@/lib/db/users';
import { CLERK_CSP } from '@/lib/clerk/config';
// Clerk CSP (manual — the Next SDK auto-injection is unavailable on vinext):
// script-src/connect-src allow the FAPI hosts (clerk-js loads from the FAPI
// host), connect-src allows the Cloudflare-challenge and *.protect.clerk.com
// hosts (the trailing :* is mandatory), frame-src allows the challenge hosts
// for bot-protection iframes, worker-src 'self' blob: for clerk-js workers.
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
  const target = new URL(to, request.url);
  url.pathname = target.pathname;
  url.search = target.search;
  return url;
}

function clearClerkCookies(response: NextResponse): void {
  for (const name of CLERK_COOKIES_TO_CLEAR) {
    response.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
}

export async function proxy(request: NextRequest) {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const pathname = request.nextUrl.pathname;
  const routeIsPublic = isPublicRoute(pathname);
  if (routeIsPublic && !hasClerkSessionCookies(request.cookies.getAll().map((c) => c.name))) {
    const csp = isDevelopment ? DEV_CSP : buildProductionCsp('');
    const response = NextResponse.next();
    addSecurityHeaders(response, isDevelopment, csp);
    return response;
  }

  // crypto.randomUUID() is available in both Node.js 19+ and Cloudflare Workers.
  const nonce = !isDevelopment ? crypto.randomUUID() : '';
  const csp = isDevelopment ? DEV_CSP : buildProductionCsp(nonce);

  const requestHeadersWithNonce = new Headers(request.headers);
  if (!isDevelopment) {
    requestHeadersWithNonce.set('x-nonce', nonce);
  }

  const passThrough = NextResponse.next({
    request: { headers: requestHeadersWithNonce },
  });

  const identity = await getSessionIdentity(request);

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
      if (identity?.sessionId) {
        try {
          await revokeSession(identity.sessionId);
        } catch {}
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
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
