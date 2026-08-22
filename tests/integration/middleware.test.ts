import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const { mockGetUser, mockSignOut, mockQueryOne } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSignOut: vi.fn(),
  mockQueryOne: vi.fn(),
}));

// Captures the cookies adapter passed to createServerClient so tests can
// simulate @supabase/ssr writing cookies through it (e.g. signOut deletions).
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type MockCookieAdapter = {
  getAll: () => { name: string; value: string; options?: Record<string, JsonValue | Date> }[];
  setAll: (
    cookies: { name: string; value: string; options?: Record<string, JsonValue | Date> }[]
  ) => void;
};
let mockCookiesAdapter: MockCookieAdapter | null = null;

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn((...args: unknown[]) => {
    // SAFETY: test double narrows mock args to known position; shape validated by test harness
    const options = args[2] as { cookies?: MockCookieAdapter } | undefined;
    mockCookiesAdapter = options?.cookies ?? null;
    return {
      auth: {
        getUser: mockGetUser,
        signOut: mockSignOut,
      },
    };
  }),
}));

vi.mock('@/lib/db/client', () => ({
  queryOne: mockQueryOne,
  query: vi.fn(),
  queryScalar: vi.fn(),
  execute: vi.fn(),
  callFunction: vi.fn(),
  callFunctionScalar: vi.fn(),
  getClient: vi.fn(),
}));

// Import proxy after mocks are set up
import {
  clearAuthorizationStateCache,
  invalidateAuthorizationState,
} from '@/lib/auth/authorization-state';
import proxy from '@/proxy';

// Helper to create NextRequest (unauthenticated)
const createRequest = (pathname: string): NextRequest => {
  return new NextRequest(new URL(pathname, 'http://localhost:3000'), {
    headers: new Headers({
      cookie: '',
    }),
  });
};

// Helper to create NextRequest with auth cookies (authenticated)
// This bypasses the early-exit optimization in middleware for public routes
const createAuthenticatedRequest = (pathname: string): NextRequest => {
  return new NextRequest(new URL(pathname, 'http://localhost:3000'), {
    headers: new Headers({
      cookie: 'sb-test-auth-token=fake-token',
    }),
  });
};

// Mock user data
const mockAuthenticatedUser = {
  id: 'user-123',
  email: 'test@example.com',
  email_confirmed_at: '2024-01-01T00:00:00Z',
};

const mockUnverifiedUser = {
  id: 'user-456',
  email: 'unverified@example.com',
  email_confirmed_at: null,
};

const mockRegularProfile = {
  is_admin: false,
  is_disabled: false,
  age_verified_at: '2026-07-12T00:00:00.000Z',
  agreed_to_terms_at: '2026-07-12T00:00:00.000Z',
};

const mockAdminProfile = {
  is_admin: true,
  is_disabled: false,
  age_verified_at: '2026-07-12T00:00:00.000Z',
  agreed_to_terms_at: '2026-07-12T00:00:00.000Z',
};

const mockDisabledProfile = {
  is_admin: false,
  is_disabled: true,
  age_verified_at: '2026-07-12T00:00:00.000Z',
  agreed_to_terms_at: '2026-07-12T00:00:00.000Z',
};

const mockMissingConsentProfile = {
  ...mockRegularProfile,
  age_verified_at: null,
  agreed_to_terms_at: null,
};

describe.skip('proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthorizationStateCache();
    mockCookiesAdapter = null;
    // Simulate @supabase/ssr: signOut writes deletion cookies through the
    // cookie adapter passed to createServerClient.
    mockSignOut.mockImplementation(async () => {
      mockCookiesAdapter?.setAll([
        { name: 'sb-test-auth-token', value: '', options: { expires: new Date(0) } },
      ]);
      return { error: null };
    });
  });

  describe('public routes', () => {
    it('should allow access to /login without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/login');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /register without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/register');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /forgot-password without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/forgot-password');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /reset-password without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/reset-password');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /legal without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/legal/privacy');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /auth/callback without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/auth/callback');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /go without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/go/somewhere');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /api/auth routes without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/api/auth/login');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /api/cron routes without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/api/cron/check-classes');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /api/queue routes without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/api/queue/process-section');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to auth email hook without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/api/auth/send-email-hook');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /api/monitoring routes without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/api/monitoring/health');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /api/unsubscribe routes without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/api/unsubscribe');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });
  });

  describe('protected routes - unauthenticated access', () => {
    it('should redirect unauthenticated users from /dashboard to /login', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/dashboard');
      const response = await proxy(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/login');
    });

    it('should redirect unauthenticated users from /admin to /login', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/admin');
      const response = await proxy(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/login');
    });

    it('should pass through unauthenticated requests to non-protected API routes', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/api/class-watches');
      const response = await proxy(request);

      // Non-protected routes pass through to the app (API handles its own auth)
      expect(response.status).toBe(200);
    });

    it('should pass through unknown paths (allows app to return 404)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/nonexistent-page');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('should redirect unauthenticated users from /dashboard/settings to /login', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/dashboard/settings');
      const response = await proxy(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/login');
    });

    it('should redirect unauthenticated users from /settings to /login', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/settings');
      const response = await proxy(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/login');
    });

    it('should allow access to root path without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });
  });

  describe('authenticated user redirects', () => {
    it('should redirect verified user from /login to /dashboard', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockRegularProfile);

      const request = createAuthenticatedRequest('/login');
      const response = await proxy(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
    });

    it('should redirect verified admin user from /login to /admin', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockAdminProfile);

      const request = createAuthenticatedRequest('/login');
      const response = await proxy(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/admin');
    });

    it('should redirect verified user from /register to /dashboard', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockRegularProfile);

      const request = createAuthenticatedRequest('/register');
      const response = await proxy(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
    });

    // NOTE: Homepage redirect tests removed - behavior intentionally moved to client-side
    // for better performance (see proxy.ts comment near the homepage redirect)

    it('should redirect admin user from /dashboard to /admin', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockAdminProfile);

      const request = createRequest('/dashboard');
      const response = await proxy(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/admin');
    });

    it('should allow regular user to access /dashboard', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockRegularProfile);

      const request = createRequest('/dashboard');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('redirects a verified user missing consent to the consent gate', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockMissingConsentProfile);

      const response = await proxy(createAuthenticatedRequest('/dashboard'));

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/consent?next=%2Fdashboard'
      );
    });

    it('protects the consent page from unauthenticated access', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const response = await proxy(createRequest('/consent'));

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/login');
    });
  });

  describe('email verification', () => {
    it('should redirect unverified user to /verify-email', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockUnverifiedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockRegularProfile);

      const request = createRequest('/dashboard');
      const response = await proxy(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/verify-email');
    });

    it('should allow unverified user to access /verify-email', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockUnverifiedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockRegularProfile);

      const request = createRequest('/verify-email');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('should allow unverified user to access /auth/callback', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockUnverifiedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockRegularProfile);

      const request = createRequest('/auth/callback');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });

    it('should allow unverified user to access root path', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockUnverifiedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockRegularProfile);

      const request = createRequest('/');
      const response = await proxy(request);

      expect(response.status).toBe(200);
    });
  });

  describe('disabled accounts', () => {
    it('should sign out and redirect disabled user to /login with error', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockDisabledProfile);
      mockSignOut.mockResolvedValue({ error: null });

      const request = createRequest('/dashboard');
      const response = await proxy(request);

      expect(mockSignOut).toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/login?error=account_disabled'
      );
    });

    it('carries signOut cookie deletions on the disabled-account redirect', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockDisabledProfile);

      const request = createAuthenticatedRequest('/dashboard');
      const response = await proxy(request);

      expect(mockSignOut).toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/login?error=account_disabled'
      );
      // signOut must delete the auth cookie on the redirect, otherwise the
      // browser keeps a valid session and every request 307s again
      // (ERR_TOO_MANY_REDIRECTS).
      const deletedCookie = response.cookies.get('sb-test-auth-token');
      expect(deletedCookie).toBeDefined();
      expect(deletedCookie?.value).toBe('');
      expect(deletedCookie?.expires).toBeDefined();
      const expiresAt =
        typeof deletedCookie?.expires === 'number'
          ? deletedCookie.expires
          : deletedCookie?.expires?.getTime();
      expect(expiresAt).toBe(0);
    });
  });

  describe('consent gate for API routes', () => {
    it('blocks verified users without consent from /api/* with 403', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockMissingConsentProfile);

      const request = createAuthenticatedRequest('/api/class-watches');
      const response = await proxy(request);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: 'Consent required',
      });
    });

    it('does not block /api/auth/consent for users without consent', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockMissingConsentProfile);

      const request = createAuthenticatedRequest('/api/auth/consent');
      const response = await proxy(request);

      expect(response.status).not.toBe(403);
    });

    it('does not block /api/auth/signout for users without consent', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockMissingConsentProfile);

      const request = createAuthenticatedRequest('/api/auth/signout');
      const response = await proxy(request);

      expect(response.status).not.toBe(403);
    });

    it('does not block /api/* for users who have consent', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockRegularProfile);

      const request = createAuthenticatedRequest('/api/class-watches');
      const response = await proxy(request);

      expect(response.status).not.toBe(403);
    });
  });

  describe('security headers', () => {
    it('should add X-Frame-Options header', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/login');
      const response = await proxy(request);

      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('should add X-Content-Type-Options header', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/login');
      const response = await proxy(request);

      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('should add Referrer-Policy header', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/login');
      const response = await proxy(request);

      expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    });

    it('should add Permissions-Policy header', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/login');
      const response = await proxy(request);

      const permissionsPolicy = response.headers.get('Permissions-Policy');
      expect(permissionsPolicy).toContain('geolocation=()');
      expect(permissionsPolicy).toContain('microphone=()');
      expect(permissionsPolicy).toContain('camera=()');
    });

    it('should add Strict-Transport-Security header in production', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/login');
      const response = await proxy(request);

      expect(response.headers.get('Strict-Transport-Security')).toBe(
        'max-age=31536000; includeSubDomains'
      );
    });

    it('should add Content-Security-Policy header', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/login');
      const response = await proxy(request);

      const csp = response.headers.get('Content-Security-Policy');
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('should use a per-request nonce in production script-src instead of unsafe-inline', async () => {
      // Tests run with NODE_ENV=test (not 'development'), so proxy uses the
      // production CSP path with a nonce generated via crypto.randomUUID().
      // Non-public routes always generate a per-request nonce. Public anonymous
      // GETs (e.g. /login) early-exit before nonce allocation for edge-cache
      // efficiency and therefore have an empty nonce — test a non-public route.
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/dashboard');
      const response = await proxy(request);

      const csp = response.headers.get('Content-Security-Policy');
      // Production script-src must contain a nonce token
      expect(csp).toMatch(/'nonce-[a-f0-9-]+'/);
      // Production script-src must NOT contain unsafe-inline
      const scriptSrcMatch = csp?.match(/script-src ([^;]+)/);
      expect(scriptSrcMatch).not.toBeNull();
      expect(scriptSrcMatch![1]).not.toContain("'unsafe-inline'");
      // External script domains must still be present
      expect(csp).toContain('https://static.cloudflareinsights.com');
      expect(csp).toContain('https://analytics.divkix.me');
      expect(csp).toContain('https://us.i.posthog.com');
    });

    it('should use a different nonce on each request', async () => {
      // Non-public routes generate a fresh nonce per request. Public anonymous
      // fast-path returns before nonce allocation (empty nonce), so nonces would
      // be identical — verify rotation on a non-public route instead.
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const response1 = await proxy(createRequest('/dashboard'));
      const response2 = await proxy(createRequest('/dashboard'));

      const csp1 = response1.headers.get('Content-Security-Policy');
      const csp2 = response2.headers.get('Content-Security-Policy');
      // Each request gets a unique nonce — they must not be equal
      expect(csp1).not.toBe(csp2);
    });

    it('should keep style-src unsafe-inline in production CSP', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/login');
      const response = await proxy(request);

      const csp = response.headers.get('Content-Security-Policy');
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    });

    it('should add security headers on redirect responses (unauthenticated to protected route)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/dashboard');
      const response = await proxy(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/login');
      // Security headers should be present on redirects
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
      expect(response.headers.get('Strict-Transport-Security')).toBe(
        'max-age=31536000; includeSubDomains'
      );
    });

    it('should add security headers on redirect responses (disabled account)', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockDisabledProfile);
      mockSignOut.mockResolvedValue({ error: null });

      const request = createRequest('/dashboard');
      const response = await proxy(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain('/login');
      // Security headers should be present on redirects
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('should add security headers on redirect responses (unverified user)', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockUnverifiedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockRegularProfile);

      const request = createRequest('/dashboard');
      const response = await proxy(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/verify-email');
      // Security headers should be present on redirects
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('should add security headers on redirect responses (auth page to dashboard)', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockRegularProfile);

      const request = createAuthenticatedRequest('/login');
      const response = await proxy(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
      // Security headers should be present on redirects
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('should add security headers on redirect responses (dashboard to admin)', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockAdminProfile);

      const request = createRequest('/dashboard');
      const response = await proxy(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/admin');
      // Security headers should be present on redirects
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });
  });

  describe('profile fetch errors', () => {
    it('should handle profile fetch error gracefully', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockRejectedValue(new Error('Database error'));

      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const request = createRequest('/dashboard');
      const response = await proxy(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/login?error=account_disabled'
      );

      consoleSpy.mockRestore();
    });

    it('should redirect to /dashboard when profile is null', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(null);

      const request = createAuthenticatedRequest('/login');
      const response = await proxy(request);

      // getRedirectPath returns '/dashboard' when profile is null
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
    });
  });

  describe('profile cache invalidation', () => {
    it('should use cached profile on subsequent requests', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockRegularProfile);

      // First request - should cache
      const request1 = createRequest('/dashboard');
      await proxy(request1);

      // Second request - should use cache (single() not called again)
      const request2 = createRequest('/dashboard');
      await proxy(request2);

      // Database should only be queried once due to cache
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
    });

    it('should fetch fresh profile after cache invalidation', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      // First call returns admin, second call returns regular user (after demotion)
      mockQueryOne.mockResolvedValueOnce(mockAdminProfile).mockResolvedValue(mockRegularProfile);

      // First request - admin user
      const request1 = createRequest('/dashboard');
      const response1 = await proxy(request1);
      expect(response1.headers.get('location')).toBe('http://localhost:3000/admin');

      // Invalidate cache (simulating admin demotion)
      invalidateAuthorizationState(mockAuthenticatedUser.id);

      // Second request - should fetch fresh profile (regular user)
      const request2 = createRequest('/dashboard');
      const response2 = await proxy(request2);
      expect(response2.status).toBe(200); // Not redirected, regular user can access dashboard

      // Database should be queried twice (before and after invalidation)
      expect(mockQueryOne).toHaveBeenCalledTimes(2);
    });

    it('should redirect to login after disabled account cache invalidation', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockSignOut.mockResolvedValue({ error: null });
      // First call returns active user, second call returns disabled
      mockQueryOne.mockResolvedValueOnce(mockRegularProfile).mockResolvedValue(mockDisabledProfile);

      // First request - active user
      const request1 = createRequest('/dashboard');
      const response1 = await proxy(request1);
      expect(response1.status).toBe(200);

      // Invalidate cache (simulating account disable)
      invalidateAuthorizationState(mockAuthenticatedUser.id);

      // Second request - should detect disabled account
      const request2 = createRequest('/dashboard');
      const response2 = await proxy(request2);
      expect(response2.headers.get('location')).toContain('/login?error=account_disabled');
      expect(mockSignOut).toHaveBeenCalled();
    });

    it('invalidateAuthorizationState returns true when key existed', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockQueryOne.mockResolvedValue(mockRegularProfile);

      // Populate cache
      const request = createRequest('/dashboard');
      await proxy(request);

      // Invalidate should return true since key existed
      const result = invalidateAuthorizationState(mockAuthenticatedUser.id);
      expect(result).toBe(true);
    });

    it('invalidateAuthorizationState returns false when key did not exist', () => {
      // Try to invalidate cache for user that was never cached
      const result = invalidateAuthorizationState('non-cached-user-id');
      expect(result).toBe(false);
    });
  });
});
