import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { fail } from '@/lib/api/response';
import { readAuthorizationState } from '@/lib/auth/authorization-state';
import { decideGate, isPublicRoute } from '@/lib/auth/decide-gate';
import { hasSupabaseAuthCookies } from '@/lib/auth/supabase-auth-cookies';
import type { Database } from './lib/supabase/database.types';

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
 */
function buildProductionCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // The sha256 hash whitelists next-themes' inline no-flash theme script,
    // which runs before hydration and cannot receive the per-request nonce
    // (the root layout intentionally avoids headers() to stay static).
    `script-src 'self' 'nonce-${nonce}' 'sha256-jGCia7LAT8V5tk83CgiiU5FMqw9uEVddMT+0ZQDzVAM=' https://static.cloudflareinsights.com https://analytics.divkix.me`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://analytics.divkix.me https://us.i.posthog.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://analytics.divkix.me https://us.i.posthog.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
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
  response.headers.set(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
  );
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

export async function proxy(request: NextRequest) {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const pathname = request.nextUrl.pathname;

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

  // Early exit for public routes WITHOUT auth cookies
  // This skips the expensive getUser() call for unauthenticated visitors
  const routeIsPublic = isPublicRoute(pathname);
  if (
    routeIsPublic &&
    !hasSupabaseAuthCookies(request.cookies.getAll().map((cookie) => cookie.name))
  ) {
    const response = NextResponse.next({ request: { headers: requestHeadersWithNonce } });
    addSecurityHeaders(response, isDevelopment, csp);
    return response;
  }

  // For routes that need auth checking, create Supabase client
  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeadersWithNonce },
  });

  const supabase = createServerClient<Database>(
    'https://osopxwuebsefhoxgeojh.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zb3B4d3VlYnNlZmhveGdlb2poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExMDQ4NzEsImV4cCI6MjA3NjY4MDg3MX0.23x_oMXkh6ELZ78aR1SqroM_X3Hbud8KlTS3RX32tpU',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeadersWithNonce },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session if expired - only called when auth cookies exist
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Check if accessing admin routes
  // Note: This is just a basic auth check for redirects. Real admin role verification
  // happens server-side in the actual admin pages/API routes using Supabase RLS and
  // user_profiles.is_admin checks. Never trust middleware alone for authorization.
  // Admin routes are protected by standard auth check below (not in publicRoutes).

  // Read the cached authorization decision. The edge gate deliberately serves a
  // (up to 30s) stale decision as a CPU saver; verifyAdmin and login read fresh.
  const authState = user ? await readAuthorizationState(supabase, user.id, { cache: true }) : null;

  const decision = decideGate({
    pathname,
    search: request.nextUrl.search,
    user: user ? { email_confirmed_at: user.email_confirmed_at ?? null } : null,
    authState,
  });

  // signout-and-redirect requires an async signOut before building the redirect
  if (decision.kind === 'signout-and-redirect') {
    await supabase.auth.signOut();
  }

  let response: NextResponse;

  switch (decision.kind) {
    case 'signout-and-redirect':
    case 'redirect': {
      const url = toRedirectUrl(request, decision.to);
      response = NextResponse.redirect(url);
      if (decision.kind === 'signout-and-redirect') {
        for (const cookie of supabaseResponse.cookies.getAll()) {
          response.cookies.set(cookie);
        }
      }
      break;
    }
    case 'forbidden': {
      response = fail(decision.message, 403);
      break;
    }
    case 'allow': {
      response = supabaseResponse;
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
