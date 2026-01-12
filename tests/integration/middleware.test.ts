import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the createServerClient
const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockSignOut = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
      signOut: mockSignOut,
    },
    from: mockFrom,
  })),
}));

// Setup mock chain
const setupMockChain = () => {
  mockFrom.mockReturnValue({ select: mockSelect });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ single: mockSingle });
};

// Import middleware after mocks are set up
import middleware from '@/middleware';

// Helper to create NextRequest
const createRequest = (pathname: string): NextRequest => {
  return new NextRequest(new URL(pathname, 'http://localhost:3000'), {
    headers: new Headers({
      cookie: '',
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
};

const mockAdminProfile = {
  is_admin: true,
  is_disabled: false,
};

const mockDisabledProfile = {
  is_admin: false,
  is_disabled: true,
};

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMockChain();
  });

  describe('public routes', () => {
    it('should allow access to /login without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/login');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /register without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/register');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /forgot-password without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/forgot-password');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /reset-password without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/reset-password');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /legal without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/legal/privacy');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /auth/callback without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/auth/callback');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /go without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/go/somewhere');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /api/auth routes without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/api/auth/login');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /api/cron routes without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/api/cron/check-classes');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /api/queue routes without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/api/queue/process-section');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /api/webhooks routes without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/api/webhooks/resend');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /api/monitoring routes without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/api/monitoring/health');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow access to /api/unsubscribe routes without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/api/unsubscribe');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });
  });

  describe('protected routes - unauthenticated access', () => {
    it('should redirect unauthenticated users from /dashboard to /login', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/dashboard');
      const response = await middleware(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/login');
    });

    it('should redirect unauthenticated users from /admin to /login', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/admin');
      const response = await middleware(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/login');
    });

    it('should redirect unauthenticated users from /api/class-watches to /login', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/api/class-watches');
      const response = await middleware(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/login');
    });

    it('should allow access to root path without authentication', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });
  });

  describe('authenticated user redirects', () => {
    it('should redirect verified user from /login to /dashboard', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: mockRegularProfile, error: null });

      const request = createRequest('/login');
      const response = await middleware(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
    });

    it('should redirect verified admin user from /login to /admin', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: mockAdminProfile, error: null });

      const request = createRequest('/login');
      const response = await middleware(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/admin');
    });

    it('should redirect verified user from /register to /dashboard', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: mockRegularProfile, error: null });

      const request = createRequest('/register');
      const response = await middleware(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
    });

    it('should redirect verified user from / to /dashboard', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: mockRegularProfile, error: null });

      const request = createRequest('/');
      const response = await middleware(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
    });

    it('should redirect admin user from / to /admin', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: mockAdminProfile, error: null });

      const request = createRequest('/');
      const response = await middleware(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/admin');
    });

    it('should redirect admin user from /dashboard to /admin', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: mockAdminProfile, error: null });

      const request = createRequest('/dashboard');
      const response = await middleware(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/admin');
    });

    it('should allow regular user to access /dashboard', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: mockRegularProfile, error: null });

      const request = createRequest('/dashboard');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });
  });

  describe('email verification', () => {
    it('should redirect unverified user to /verify-email', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockUnverifiedUser },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: mockRegularProfile, error: null });

      const request = createRequest('/dashboard');
      const response = await middleware(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/verify-email');
    });

    it('should allow unverified user to access /verify-email', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockUnverifiedUser },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: mockRegularProfile, error: null });

      const request = createRequest('/verify-email');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow unverified user to access /auth/callback', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockUnverifiedUser },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: mockRegularProfile, error: null });

      const request = createRequest('/auth/callback');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should allow unverified user to access root path', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockUnverifiedUser },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: mockRegularProfile, error: null });

      const request = createRequest('/');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });
  });

  describe('disabled accounts', () => {
    it('should sign out and redirect disabled user to /login with error', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: mockDisabledProfile, error: null });
      mockSignOut.mockResolvedValue({ error: null });

      const request = createRequest('/dashboard');
      const response = await middleware(request);

      expect(mockSignOut).toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/login?error=account_disabled'
      );
    });
  });

  describe('security headers', () => {
    it('should add X-Frame-Options header', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/login');
      const response = await middleware(request);

      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('should add X-Content-Type-Options header', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/login');
      const response = await middleware(request);

      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('should add Referrer-Policy header', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/login');
      const response = await middleware(request);

      expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    });

    it('should add Permissions-Policy header', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/login');
      const response = await middleware(request);

      const permissionsPolicy = response.headers.get('Permissions-Policy');
      expect(permissionsPolicy).toContain('geolocation=()');
      expect(permissionsPolicy).toContain('microphone=()');
      expect(permissionsPolicy).toContain('camera=()');
    });

    it('should add Content-Security-Policy header', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const request = createRequest('/login');
      const response = await middleware(request);

      const csp = response.headers.get('Content-Security-Policy');
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
    });
  });

  describe('profile fetch errors', () => {
    it('should handle profile fetch error gracefully', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockSingle.mockRejectedValue(new Error('Database error'));

      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const request = createRequest('/dashboard');
      const response = await middleware(request);

      // Should still allow access (profile is null, not admin)
      expect(response.status).toBe(200);

      consoleSpy.mockRestore();
    });

    it('should redirect to /dashboard when profile is null', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: mockAuthenticatedUser },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: null, error: null });

      const request = createRequest('/login');
      const response = await middleware(request);

      // getRedirectPath returns '/dashboard' when profile is null
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
    });
  });
});
