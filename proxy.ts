import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { hasSupabaseAuthCookies } from '@/lib/auth/supabase-auth-cookies';
import { TtlCache } from '@/lib/cache/ttl-cache';
import type { Database } from './lib/supabase/database.types';

/**
 * User profile data from database
 */
interface UserProfile {
  is_admin: boolean;
  is_disabled: boolean;
}

/**
 * Per-isolate profile cache with 30-second TTL for authorization decisions.
 * Reduces redundant DB lookups while ensuring stale data doesn't persist long.
 */
const profileCache = new TtlCache<UserProfile>(30 * 1000);

/** Clear the entire profile cache. Exposed for test isolation. */
export function clearProfileCache(): void {
  profileCache.clear();
}

/** Invalidate cached profile for a specific user. Call when profile is updated. */
export function invalidateProfileCache(userId: string): boolean {
  return profileCache.delete(userId);
}

/**
 * Pre-computed CSP headers (computed once at module load, not per-request)
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://analytics.divkix.me",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://analytics.divkix.me",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://analytics.divkix.me",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * Public routes that don't require authentication
 */
const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/legal',
  '/auth/callback',
  '/go',
  '/faq',
  '/blog',
];

/**
 * Auth pages that authenticated users should be redirected away from
 * NOTE: /reset-password is NOT included because users authenticate via recovery token
 * and need to access this page while authenticated to set their new password
 */
const AUTH_PAGES = ['/login', '/register', '/forgot-password'];

/**
 * Protected route prefixes that require authentication.
 * Unknown routes outside these prefixes pass through to the app (which returns 404).
 */
const PROTECTED_ROUTE_PREFIXES = ['/dashboard', '/admin', '/settings', '/verify-email'];

/**
 * Add security headers to a response
 */
function addSecurityHeaders(response: NextResponse, isDevelopment: boolean): void {
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
  response.headers.set('Content-Security-Policy', isDevelopment ? DEV_CSP : PRODUCTION_CSP);
}

/**
 * Check if a pathname matches public routes
 */
function isPublicRoute(pathname: string): boolean {
  return (
    pathname === '/' ||
    PUBLIC_ROUTES.some((route) => pathname.startsWith(route)) ||
    pathname === '/sitemap.xml' ||
    pathname === '/robots.txt' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/queue/') ||
    pathname.startsWith('/api/webhooks/') ||
    pathname.startsWith('/api/monitoring/') ||
    pathname.startsWith('/api/unsubscribe')
  );
}

/**
 * Get user profile data from database with per-isolate TTL cache.
 * Returns null if user not found or error occurs.
 */
async function getUserProfile(
  supabase: ReturnType<typeof createServerClient<Database>>,
  userId: string
): Promise<UserProfile | null> {
  const cached = profileCache.get(userId);
  if (cached) return cached;

  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('is_admin, is_disabled')
      .eq('user_id', userId)
      .single();

    if (profile) {
      profileCache.set(userId, profile);
    }

    return profile;
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }
}

/**
 * Helper function to determine redirect path based on user's admin status.
 * Defaults to /dashboard if user is not admin.
 */
function getRedirectPath(profile: UserProfile | null): string {
  return profile?.is_admin ? '/admin' : '/dashboard';
}

export async function proxy(request: NextRequest) {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const pathname = request.nextUrl.pathname;

  // Early exit for public routes WITHOUT auth cookies
  // This skips the expensive getUser() call for unauthenticated visitors
  const routeIsPublic = isPublicRoute(pathname);
  if (
    routeIsPublic &&
    !hasSupabaseAuthCookies(request.cookies.getAll().map((cookie) => cookie.name))
  ) {
    const response = NextResponse.next({ request });
    addSecurityHeaders(response, isDevelopment);
    return response;
  }

  // For routes that need auth checking, create Supabase client
  let supabaseResponse = NextResponse.next({
    request,
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
            request,
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

  // Fetch user profile data once and cache for the entire request
  let userProfile: UserProfile | null = null;
  if (user) {
    userProfile = await getUserProfile(supabase, user.id);

    // If account is disabled, sign out and redirect to login
    if (userProfile?.is_disabled) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('error', 'account_disabled');
      const redirectResponse = NextResponse.redirect(url);
      addSecurityHeaders(redirectResponse, isDevelopment);
      return redirectResponse;
    }
  }

  // Check email verification status
  if (user && !user.email_confirmed_at) {
    // Allow access to verification page, auth callback, and password reset
    // Password reset is allowed because the recovery flow itself verifies email access
    const allowedPaths = ['/verify-email', '/auth/callback', '/reset-password'];
    const isAllowedPath = allowedPaths.some((path) => pathname.startsWith(path));

    if (!isAllowedPath && pathname !== '/') {
      const url = request.nextUrl.clone();
      url.pathname = '/verify-email';
      const redirectResponse = NextResponse.redirect(url);
      addSecurityHeaders(redirectResponse, isDevelopment);
      return redirectResponse;
    }
  }

  // Redirect to login if accessing protected route while not authenticated
  // This includes admin routes - unauthenticated users cannot access admin pages
  const isProtectedRoute = PROTECTED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (!user && isProtectedRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    const redirectResponse = NextResponse.redirect(url);
    addSecurityHeaders(redirectResponse, isDevelopment);
    return redirectResponse;
  }

  // Redirect authenticated users from auth pages to their dashboard
  // Only redirect from specific auth pages to avoid loops with next-themes
  const isAuthPage = AUTH_PAGES.some((route) => pathname.startsWith(route));

  if (user?.email_confirmed_at && isAuthPage) {
    const redirectPath = getRedirectPath(userProfile);
    // Only redirect if not already on the target path to prevent loops
    if (pathname !== redirectPath) {
      const url = request.nextUrl.clone();
      url.pathname = redirectPath;
      const redirectResponse = NextResponse.redirect(url);
      addSecurityHeaders(redirectResponse, isDevelopment);
      return redirectResponse;
    }
  }

  // Homepage redirect moved to client-side for better performance
  // Authenticated users will be redirected by the homepage component itself

  // Redirect admin users from /dashboard to /admin
  // Regular users can access /dashboard, but admins should use /admin exclusively
  if (user?.email_confirmed_at && pathname.startsWith('/dashboard')) {
    if (userProfile?.is_admin) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin';
      const redirectResponse = NextResponse.redirect(url);
      addSecurityHeaders(redirectResponse, isDevelopment);
      return redirectResponse;
    }
  }

  // Add security headers to all responses
  addSecurityHeaders(supabaseResponse, isDevelopment);
  return supabaseResponse;
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
