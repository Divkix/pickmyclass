import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { verifyAdmin } from '@/lib/auth/admin';

const { mockCreateClient, mockGetUser, mockReadAuthorizationState, mockRedirect } = vi.hoisted(
  () => ({
    mockCreateClient: vi.fn(),
    mockGetUser: vi.fn(),
    mockReadAuthorizationState: vi.fn(),
    mockRedirect: vi.fn((path: string) => {
      throw new Error(`redirect:${path}`);
    }),
  })
);

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

// The Supabase server client is still used by verifyAdmin, but only for the
// auth.getUser() session check — all profile/admin data access now flows through
// readAuthorizationState (mocked below).
vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/auth/authorization-state', () => ({
  readAuthorizationState: mockReadAuthorizationState,
}));

const user = { id: 'user-123', email: 'admin@example.com' };

describe('verifyAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user }, error: null });
    mockReadAuthorizationState.mockResolvedValue({
      is_admin: true,
      is_disabled: false,
      has_consent: true,
    });
    mockCreateClient.mockResolvedValue({
      auth: { getUser: mockGetUser },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the authenticated user when their profile is marked admin', async () => {
    await expect(verifyAdmin()).resolves.toBe(user);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated users to login', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'no session' } });

    await expect(verifyAdmin()).rejects.toThrow('redirect:/login');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  it('redirects users whose admin profile lookup fails', async () => {
    // A failed lookup (DB error) makes readAuthorizationState fail-closed to
    // { is_disabled: true }, which verifyAdmin routes to /login.
    mockReadAuthorizationState.mockResolvedValueOnce({
      is_admin: false,
      is_disabled: true,
      has_consent: false,
    });

    await expect(verifyAdmin()).rejects.toThrow('redirect:/login');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  it('redirects authenticated non-admin users', async () => {
    mockReadAuthorizationState.mockResolvedValueOnce({
      is_admin: false,
      is_disabled: false,
      has_consent: true,
    });

    await expect(verifyAdmin()).rejects.toThrow('redirect:/dashboard');
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
  });
});
