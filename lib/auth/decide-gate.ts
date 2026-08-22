import type { AuthorizationState } from '@/lib/auth/authorization-state';

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
  '/auth/post-oauth',
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
const PROTECTED_ROUTE_PREFIXES = ['/dashboard', '/admin', '/settings', '/verify-email', '/consent'];

function isPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

const API_PUBLIC_PREFIXES = [
  '/api/auth',
  '/api/cron',
  '/api/queue',
  '/api/webhooks',
  '/api/monitoring',
  '/api/unsubscribe',
];

/**
 * Check if a pathname matches public routes
 */
export function isPublicRoute(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/sitemap.xml' ||
    pathname === '/robots.txt' ||
    PUBLIC_ROUTES.some((route) => isPathPrefix(pathname, route)) ||
    API_PUBLIC_PREFIXES.some((prefix) => isPathPrefix(pathname, prefix))
  );
}

/**
 * Check if a pathname matches protected route prefixes.
 */
export function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTE_PREFIXES.some((prefix) => isPathPrefix(pathname, prefix));
}

/**
 * Helper function to determine redirect path based on user's admin status.
 * Defaults to /dashboard if user is not admin.
 */
export function getRedirectPath(authState: AuthorizationState | null): string {
  if (authState && !authState.has_consent) return '/consent';
  return authState?.is_admin ? '/admin' : '/dashboard';
}

export type GateDecision =
  | { kind: 'allow' }
  | { kind: 'redirect'; to: string }
  | { kind: 'signout-and-redirect'; to: string }
  | { kind: 'forbidden'; message: 'Consent required' };

export function decideGate(input: {
  pathname: string;
  search: string;
  user: { email_confirmed_at: string | null } | null;
  authState: AuthorizationState | null;
}): GateDecision {
  const { pathname, search, user, authState } = input;
  const isVerified = !!user?.email_confirmed_at;
  const lacksConsent = !!isVerified && !!authState && !authState.has_consent;
  const hasConsent = !!isVerified && !!authState?.has_consent;

  // 1) disabled -> signout-and-redirect
  if (user && authState?.is_disabled) {
    return { kind: 'signout-and-redirect', to: '/login?error=account_disabled' };
  }

  // 2) unverified -> /verify-email (allowlist)
  if (user && !user.email_confirmed_at) {
    const allowedPaths = ['/verify-email', '/auth/callback', '/auth/post-oauth', '/reset-password'];
    const isAllowedPath = allowedPaths.some((p) => isPathPrefix(pathname, p));
    if (!isAllowedPath && pathname !== '/') {
      return { kind: 'redirect', to: '/verify-email' };
    }
  }

  const isProtected = isProtectedRoute(pathname);

  // 3) !user + protected -> /login
  if (!user && isProtected) {
    return { kind: 'redirect', to: '/login' };
  }

  // 4) verified + lacksConsent + protected + !/consent -> /consent?next=...
  if (lacksConsent && isProtected && pathname !== '/consent') {
    const next = `${pathname}${search}`;
    return { kind: 'redirect', to: `/consent?next=${encodeURIComponent(next)}` };
  }

  // 5) verified + lacksConsent + /api/ not consent/signout -> forbidden
  if (
    lacksConsent &&
    pathname.startsWith('/api/') &&
    pathname !== '/api/auth/consent' &&
    pathname !== '/api/auth/signout'
  ) {
    return { kind: 'forbidden', message: 'Consent required' };
  }

  // 6) verified + hasConsent + /consent -> getRedirectPath
  if (hasConsent && pathname === '/consent') {
    return { kind: 'redirect', to: getRedirectPath(authState) };
  }

  // 7) verified + AUTH_PAGES -> getRedirectPath
  const isAuthPage = AUTH_PAGES.some((route) => isPathPrefix(pathname, route));
  if (isVerified && isAuthPage) {
    const redirectPath = getRedirectPath(authState);
    if (pathname !== redirectPath) {
      return { kind: 'redirect', to: redirectPath };
    }
  }

  // 8) verified + /dashboard + is_admin -> /admin
  if (isVerified && isPathPrefix(pathname, '/dashboard')) {
    if (authState?.is_admin) {
      return { kind: 'redirect', to: '/admin' };
    }
  }

  // 9) allow
  return { kind: 'allow' };
}
