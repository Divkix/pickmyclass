import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from './lib/supabase/database.types';

/**
 * User profile data from database
 */
interface UserProfile {
  is_admin: boolean;
  is_disabled: boolean;
}

/**
 * Get user profile data from database (cached per request)
 * Returns null if user not found or error occurs
 */
async function getUserProfile(
  supabase: ReturnType<typeof createServerClient<Database>>,
  userId: string
): Promise<UserProfile | null> {
  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('is_admin, is_disabled')
      .eq('user_id', userId)
      .single();

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

export default async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  // Refresh session if expired
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Define public routes that don't require authentication
  const publicRoutes = [
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/legal',
    '/auth/callback',
    '/go',
  ];
  const isPublicRoute =
    publicRoutes.some((route) => request.nextUrl.pathname.startsWith(route)) ||
    request.nextUrl.pathname === '/sitemap.xml' || // SEO sitemap
    request.nextUrl.pathname === '/robots.txt' || // SEO robots file
    request.nextUrl.pathname.startsWith('/api/auth/') || // Auth API routes must be public for login flow
    request.nextUrl.pathname.startsWith('/api/cron') || // Cron routes use Bearer token auth
    request.nextUrl.pathname.startsWith('/api/queue/') || // Queue routes use Bearer token auth
    request.nextUrl.pathname.startsWith('/api/webhooks/') || // Webhook routes use their own auth
    request.nextUrl.pathname.startsWith('/api/monitoring/') || // Monitoring routes are public
    request.nextUrl.pathname.startsWith('/api/unsubscribe'); // Unsubscribe routes are public

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
      return NextResponse.redirect(url);
    }
  }

  // Check email verification status
  if (user && !user.email_confirmed_at) {
    // Allow access to verification page and auth callback only
    const allowedPaths = ['/verify-email', '/auth/callback'];
    const isAllowedPath = allowedPaths.some((path) => request.nextUrl.pathname.startsWith(path));

    if (!isAllowedPath && request.nextUrl.pathname !== '/') {
      const url = request.nextUrl.clone();
      url.pathname = '/verify-email';
      return NextResponse.redirect(url);
    }
  }

  // Redirect to login if accessing protected route while not authenticated
  // This includes admin routes - unauthenticated users cannot access admin pages
  if (!user && !isPublicRoute && request.nextUrl.pathname !== '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Redirect to admin or dashboard based on user role when accessing auth pages while authenticated
  if (
    user &&
    user.email_confirmed_at &&
    isPublicRoute &&
    !request.nextUrl.pathname.startsWith('/legal')
  ) {
    const redirectPath = getRedirectPath(userProfile);
    const url = request.nextUrl.clone();
    url.pathname = redirectPath;
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users from home page to admin or dashboard based on role
  if (user && user.email_confirmed_at && request.nextUrl.pathname === '/') {
    const redirectPath = getRedirectPath(userProfile);
    const url = request.nextUrl.clone();
    url.pathname = redirectPath;
    return NextResponse.redirect(url);
  }

  // Redirect admin users from /dashboard to /admin
  // Regular users can access /dashboard, but admins should use /admin exclusively
  if (user && user.email_confirmed_at && request.nextUrl.pathname.startsWith('/dashboard')) {
    if (userProfile?.is_admin) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin';
      return NextResponse.redirect(url);
    }
  }

  // Add security headers to all responses
  supabaseResponse.headers.set('X-Frame-Options', 'DENY');
  supabaseResponse.headers.set('X-Content-Type-Options', 'nosniff');
  supabaseResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  supabaseResponse.headers.set(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
  );

  // Content Security Policy
  // Allow self, Supabase domains, Google OAuth, and inline styles for shadcn/ui
  // Remove 'unsafe-eval' in production for security hardening
  const isDevelopment = process.env.NODE_ENV === 'development';
  const scriptSrc = isDevelopment
    ? "'self' 'unsafe-eval' 'unsafe-inline' https://analytics.divkix.me" // Dev: unsafe-eval needed for HMR
    : "'self' 'unsafe-inline' https://analytics.divkix.me https://static.cloudflareinsights.com"; // Production: allow analytics + Cloudflare Insights

  const cspDirectives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'", // unsafe-inline needed for Tailwind/shadcn
    "img-src 'self' data: https:", // data: for base64 images, https: for external images
    "font-src 'self' data:", // data: for inline fonts
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://analytics.divkix.me", // Supabase API calls, Realtime WebSockets, and analytics
    "frame-ancestors 'none'", // Equivalent to X-Frame-Options: DENY
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  supabaseResponse.headers.set('Content-Security-Policy', cspDirectives);

  return supabaseResponse;
}

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
