import { describe, expect, it } from 'vite-plus/test';
import {
  decideGate,
  getRedirectPath,
  isProtectedRoute,
  isPublicRoute,
} from '@/lib/auth/decide-gate';

const verifiedUser = { email_confirmed_at: '2024-01-01T00:00:00Z' };
const unverifiedUser = { email_confirmed_at: null as string | null };

const adminConsent = { is_admin: true, is_disabled: false, has_consent: true };
const regularConsent = { is_admin: false, is_disabled: false, has_consent: true };
const missingConsent = { is_admin: false, is_disabled: false, has_consent: false };
const missingConsentAdmin = { is_admin: true, is_disabled: false, has_consent: false };
const disabledState = { is_admin: false, is_disabled: true, has_consent: true };
const disabledAdmin = { is_admin: true, is_disabled: true, has_consent: false };

describe('decideGate', () => {
  it('disabled precedence over unverified and protected', () => {
    expect(
      decideGate({
        pathname: '/dashboard',
        search: '',
        user: unverifiedUser,
        authState: disabledState,
      })
    ).toEqual({ kind: 'signout-and-redirect', to: '/login?error=account_disabled' });
  });

  it('disabled precedence even on public route', () => {
    expect(
      decideGate({ pathname: '/login', search: '', user: verifiedUser, authState: disabledState })
    ).toEqual({ kind: 'signout-and-redirect', to: '/login?error=account_disabled' });
  });

  it('disabled still wins with missing consent and api path', () => {
    expect(
      decideGate({
        pathname: '/api/class-watches',
        search: '',
        user: verifiedUser,
        authState: disabledAdmin,
      })
    ).toEqual({ kind: 'signout-and-redirect', to: '/login?error=account_disabled' });
  });

  it('null authState with user not disabled allows (no crash)', () => {
    expect(
      decideGate({ pathname: '/dashboard', search: '', user: verifiedUser, authState: null })
    ).toEqual({ kind: 'allow' });
  });

  // 2) unverified
  it('unverified -> /verify-email for protected', () => {
    expect(
      decideGate({
        pathname: '/dashboard',
        search: '',
        user: unverifiedUser,
        authState: regularConsent,
      })
    ).toEqual({ kind: 'redirect', to: '/verify-email' });
  });

  it('unverified allowed /verify-email', () => {
    expect(
      decideGate({
        pathname: '/verify-email',
        search: '',
        user: unverifiedUser,
        authState: regularConsent,
      })
    ).toEqual({ kind: 'allow' });
  });

  it('unverified allowed /verify-email/subpath (startsWith)', () => {
    expect(
      decideGate({
        pathname: '/verify-email/something',
        search: '',
        user: unverifiedUser,
        authState: regularConsent,
      })
    ).toEqual({ kind: 'allow' });
  });

  it('unverified allowed /auth/callback', () => {
    expect(
      decideGate({
        pathname: '/auth/callback',
        search: '?code=123',
        user: unverifiedUser,
        authState: regularConsent,
      })
    ).toEqual({ kind: 'allow' });
  });

  it('unverified allowed /reset-password', () => {
    expect(
      decideGate({
        pathname: '/reset-password',
        search: '',
        user: unverifiedUser,
        authState: regularConsent,
      })
    ).toEqual({ kind: 'allow' });
  });

  it('unverified allowed /', () => {
    expect(
      decideGate({ pathname: '/', search: '', user: unverifiedUser, authState: regularConsent })
    ).toEqual({ kind: 'allow' });
  });

  it('unverified non-allowlisted other path -> redirect', () => {
    expect(
      decideGate({ pathname: '/faq', search: '', user: unverifiedUser, authState: regularConsent })
    ).toEqual({ kind: 'redirect', to: '/verify-email' });
  });

  // 3) !user + protected -> /login
  it('unauthenticated protected /dashboard -> /login', () => {
    expect(decideGate({ pathname: '/dashboard', search: '', user: null, authState: null })).toEqual(
      {
        kind: 'redirect',
        to: '/login',
      }
    );
  });

  it('unauthenticated protected /admin -> /login', () => {
    expect(decideGate({ pathname: '/admin', search: '', user: null, authState: null })).toEqual({
      kind: 'redirect',
      to: '/login',
    });
  });

  it('unauthenticated /consent -> /login (consent is protected)', () => {
    expect(decideGate({ pathname: '/consent', search: '', user: null, authState: null })).toEqual({
      kind: 'redirect',
      to: '/login',
    });
  });

  it('unauthenticated non-protected -> allow', () => {
    expect(decideGate({ pathname: '/faq', search: '', user: null, authState: null })).toEqual({
      kind: 'allow',
    });
  });

  it('unauthenticated /api/class-watches -> allow (not protected prefix)', () => {
    expect(
      decideGate({ pathname: '/api/class-watches', search: '', user: null, authState: null })
    ).toEqual({ kind: 'allow' });
  });

  // 4) verified + !has_consent + protected + !/consent -> /consent?next=
  it('missing consent protected -> /consent?next', () => {
    expect(
      decideGate({
        pathname: '/dashboard',
        search: '',
        user: verifiedUser,
        authState: missingConsent,
      })
    ).toEqual({ kind: 'redirect', to: '/consent?next=%2Fdashboard' });
  });

  it('missing consent preserves search in next param', () => {
    expect(
      decideGate({
        pathname: '/dashboard',
        search: '?foo=bar&x=1',
        user: verifiedUser,
        authState: missingConsent,
      })
    ).toEqual({ kind: 'redirect', to: '/consent?next=%2Fdashboard%3Ffoo%3Dbar%26x%3D1' });
  });

  it('missing consent but already on /consent -> allow (not redirect loop)', () => {
    expect(
      decideGate({
        pathname: '/consent',
        search: '',
        user: verifiedUser,
        authState: missingConsent,
      })
    ).toEqual({ kind: 'allow' });
  });

  it('with consent on protected -> allow', () => {
    expect(
      decideGate({
        pathname: '/dashboard',
        search: '',
        user: verifiedUser,
        authState: regularConsent,
      })
    ).toEqual({ kind: 'allow' });
  });

  it('null authState with verified user on protected -> allow (treated as not missing consent)', () => {
    expect(
      decideGate({ pathname: '/dashboard', search: '', user: verifiedUser, authState: null })
    ).toEqual({ kind: 'allow' });
  });

  // 5) verified + !has_consent + /api/ -> forbidden
  it('missing consent api -> forbidden', () => {
    expect(
      decideGate({
        pathname: '/api/class-watches',
        search: '',
        user: verifiedUser,
        authState: missingConsent,
      })
    ).toEqual({ kind: 'forbidden', message: 'Consent required' });
  });

  it('missing consent api with search -> still forbidden', () => {
    expect(
      decideGate({
        pathname: '/api/class-watches',
        search: '?q=1',
        user: verifiedUser,
        authState: missingConsent,
      })
    ).toEqual({ kind: 'forbidden', message: 'Consent required' });
  });

  it('missing consent allowlisted /api/auth/consent -> allow', () => {
    expect(
      decideGate({
        pathname: '/api/auth/consent',
        search: '',
        user: verifiedUser,
        authState: missingConsent,
      })
    ).toEqual({ kind: 'allow' });
  });

  it('missing consent allowlisted /api/auth/signout -> allow', () => {
    expect(
      decideGate({
        pathname: '/api/auth/signout',
        search: '',
        user: verifiedUser,
        authState: missingConsent,
      })
    ).toEqual({ kind: 'allow' });
  });

  it('with consent api -> allow', () => {
    expect(
      decideGate({
        pathname: '/api/class-watches',
        search: '',
        user: verifiedUser,
        authState: regularConsent,
      })
    ).toEqual({ kind: 'allow' });
  });

  // 6) verified + has_consent + /consent -> redirect to getRedirectPath
  it('has_consent on /consent as regular -> /dashboard', () => {
    expect(
      decideGate({
        pathname: '/consent',
        search: '',
        user: verifiedUser,
        authState: regularConsent,
      })
    ).toEqual({ kind: 'redirect', to: '/dashboard' });
  });

  it('has_consent on /consent as admin -> /admin', () => {
    expect(
      decideGate({ pathname: '/consent', search: '', user: verifiedUser, authState: adminConsent })
    ).toEqual({ kind: 'redirect', to: '/admin' });
  });

  // 7) verified + AUTH_PAGES -> getRedirectPath
  it('verified on /login as regular -> /dashboard', () => {
    expect(
      decideGate({ pathname: '/login', search: '', user: verifiedUser, authState: regularConsent })
    ).toEqual({ kind: 'redirect', to: '/dashboard' });
  });

  it('verified on /login as admin -> /admin', () => {
    expect(
      decideGate({ pathname: '/login', search: '', user: verifiedUser, authState: adminConsent })
    ).toEqual({ kind: 'redirect', to: '/admin' });
  });

  it('verified on /register -> redirect', () => {
    expect(
      decideGate({
        pathname: '/register',
        search: '',
        user: verifiedUser,
        authState: regularConsent,
      })
    ).toEqual({ kind: 'redirect', to: '/dashboard' });
  });

  it('verified on /forgot-password -> redirect', () => {
    expect(
      decideGate({
        pathname: '/forgot-password',
        search: '',
        user: verifiedUser,
        authState: regularConsent,
      })
    ).toEqual({ kind: 'redirect', to: '/dashboard' });
  });

  it('verified on /login with missing consent -> /consent', () => {
    expect(
      decideGate({ pathname: '/login', search: '', user: verifiedUser, authState: missingConsent })
    ).toEqual({ kind: 'redirect', to: '/consent' });
  });

  it('verified on /login with missing consent admin -> /consent (has_consent false precedes is_admin)', () => {
    expect(
      decideGate({
        pathname: '/login',
        search: '',
        user: verifiedUser,
        authState: missingConsentAdmin,
      })
    ).toEqual({ kind: 'redirect', to: '/consent' });
  });

  it('AUTH_PAGES matching is startsWith - /login/foo redirects', () => {
    expect(
      decideGate({
        pathname: '/login/foo',
        search: '',
        user: verifiedUser,
        authState: regularConsent,
      })
    ).toEqual({ kind: 'redirect', to: '/dashboard' });
  });

  it('/reset-password NOT in AUTH_PAGES -> allow even when verified', () => {
    expect(
      decideGate({
        pathname: '/reset-password',
        search: '',
        user: verifiedUser,
        authState: regularConsent,
      })
    ).toEqual({ kind: 'allow' });
  });

  it('unverified on AUTH_PAGES -> redirects to /verify-email (unverified takes precedence)', () => {
    expect(
      decideGate({
        pathname: '/login',
        search: '',
        user: unverifiedUser,
        authState: regularConsent,
      })
    ).toEqual({ kind: 'redirect', to: '/verify-email' });
  });

  // 8) verified + /dashboard + is_admin -> /admin
  it('admin on /dashboard -> /admin', () => {
    expect(
      decideGate({
        pathname: '/dashboard',
        search: '',
        user: verifiedUser,
        authState: adminConsent,
      })
    ).toEqual({ kind: 'redirect', to: '/admin' });
  });

  it('admin on /dashboard/subpath -> /admin', () => {
    expect(
      decideGate({
        pathname: '/dashboard/settings',
        search: '',
        user: verifiedUser,
        authState: adminConsent,
      })
    ).toEqual({ kind: 'redirect', to: '/admin' });
  });

  it('regular on /dashboard -> allow', () => {
    expect(
      decideGate({
        pathname: '/dashboard',
        search: '',
        user: verifiedUser,
        authState: regularConsent,
      })
    ).toEqual({ kind: 'allow' });
  });

  it('admin on /admin -> allow (not dashboard)', () => {
    expect(
      decideGate({ pathname: '/admin', search: '', user: verifiedUser, authState: adminConsent })
    ).toEqual({ kind: 'allow' });
  });

  // 9) allow fallthrough
  it('verified regular on / -> allow', () => {
    expect(
      decideGate({ pathname: '/', search: '', user: verifiedUser, authState: regularConsent })
    ).toEqual({ kind: 'allow' });
  });

  it('null user on public -> allow', () => {
    expect(decideGate({ pathname: '/', search: '', user: null, authState: null })).toEqual({
      kind: 'allow',
    });
  });
});

describe('isPublicRoute', () => {
  it('matches exactly and via startsWith', () => {
    expect(isPublicRoute('/')).toBe(true);
    expect(isPublicRoute('/login')).toBe(true);
    expect(isPublicRoute('/login/foo')).toBe(true);
    expect(isPublicRoute('/legal/privacy')).toBe(true);
    expect(isPublicRoute('/api/auth/login')).toBe(true);
    expect(isPublicRoute('/api/cron')).toBe(true);
    expect(isPublicRoute('/api/queue/process-section')).toBe(true);
    expect(isPublicRoute('/api/monitoring/health')).toBe(true);
    expect(isPublicRoute('/api/unsubscribe')).toBe(true);
    expect(isPublicRoute('/sitemap.xml')).toBe(true);
    expect(isPublicRoute('/robots.txt')).toBe(true);
    expect(isPublicRoute('/dashboard')).toBe(false);
    expect(isPublicRoute('/api/class-watches')).toBe(false);
  });
});

describe('isProtectedRoute', () => {
  it('matches prefix exactly and via slash', () => {
    expect(isProtectedRoute('/dashboard')).toBe(true);
    expect(isProtectedRoute('/dashboard/')).toBe(true);
    expect(isProtectedRoute('/dashboard/settings')).toBe(true);
    expect(isProtectedRoute('/admin')).toBe(true);
    expect(isProtectedRoute('/admin/users')).toBe(true);
    expect(isProtectedRoute('/consent')).toBe(true);
    expect(isProtectedRoute('/verify-email')).toBe(true);
    expect(isProtectedRoute('/settings')).toBe(true);
    expect(isProtectedRoute('/login')).toBe(false);
    expect(isProtectedRoute('/api/class-watches')).toBe(false);
    expect(isProtectedRoute('/')).toBe(false);
  });
});

describe('getRedirectPath', () => {
  it('returns /consent when has_consent false even if admin', () => {
    expect(getRedirectPath(missingConsentAdmin)).toBe('/consent');
    expect(getRedirectPath(missingConsent)).toBe('/consent');
  });
  it('returns /admin when admin with consent', () => {
    expect(getRedirectPath(adminConsent)).toBe('/admin');
  });
  it('returns /dashboard when regular with consent', () => {
    expect(getRedirectPath(regularConsent)).toBe('/dashboard');
  });
  it('returns /dashboard when null', () => {
    expect(getRedirectPath(null)).toBe('/dashboard');
  });
});
