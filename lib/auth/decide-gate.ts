import type { AuthorizationState } from '@/lib/auth/authorization-state';

const PUBLIC_ROUTES = [
  '/sign-in',
  '/sign-up',
  '/legal',
  '/auth/post-oauth',
  '/go',
  '/faq',
  '/blog',
];

const AUTH_PAGES = ['/sign-in', '/sign-up'];

const PROTECTED_ROUTE_PREFIXES = ['/dashboard', '/admin', '/settings', '/consent'];

function isPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

const API_PUBLIC_PREFIXES = [
  '/api/auth',
  '/api/cron',
  '/api/webhooks',
  '/api/monitoring',
  '/api/unsubscribe',
];

export function isPublicRoute(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/sitemap.xml' ||
    pathname === '/robots.txt' ||
    PUBLIC_ROUTES.some((route) => isPathPrefix(pathname, route)) ||
    API_PUBLIC_PREFIXES.some((prefix) => isPathPrefix(pathname, prefix))
  );
}

export function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTE_PREFIXES.some((prefix) => isPathPrefix(pathname, prefix));
}

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

  if (user && authState?.is_disabled) {
    return { kind: 'signout-and-redirect', to: '/sign-in?error=account_disabled' };
  }

  if (user && !user.email_confirmed_at) {
    const allowedPaths = ['/auth/post-oauth', '/sign-in'];
    const isAllowedPath = allowedPaths.some((p) => isPathPrefix(pathname, p));
    if (!isAllowedPath && pathname !== '/') {
      return { kind: 'redirect', to: '/sign-in' };
    }
  }

  const isProtected = isProtectedRoute(pathname);

  if (!user && isProtected) {
    return { kind: 'redirect', to: '/sign-in' };
  }

  if (lacksConsent && isProtected && pathname !== '/consent') {
    const next = `${pathname}${search}`;
    return { kind: 'redirect', to: `/consent?next=${encodeURIComponent(next)}` };
  }

  if (
    lacksConsent &&
    pathname.startsWith('/api/') &&
    pathname !== '/api/auth/consent' &&
    pathname !== '/api/auth/signout'
  ) {
    return { kind: 'forbidden', message: 'Consent required' };
  }

  if (hasConsent && pathname === '/consent') {
    return { kind: 'redirect', to: getRedirectPath(authState) };
  }

  const isAuthPage = AUTH_PAGES.some((route) => isPathPrefix(pathname, route));
  if (isVerified && isAuthPage) {
    const redirectPath = getRedirectPath(authState);
    if (pathname !== redirectPath) {
      return { kind: 'redirect', to: redirectPath };
    }
  }

  if (isVerified && isPathPrefix(pathname, '/dashboard')) {
    if (authState?.is_admin) {
      return { kind: 'redirect', to: '/admin' };
    }
  }

  return { kind: 'allow' };
}
