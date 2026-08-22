import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { verifyAdmin } from '@/lib/auth/admin';

const {
  mockGetSessionIdentityFromHeaders,
  mockReadAuthorizationState,
  mockQueryOne,
  mockRedirect,
  mockHeaders,
} = vi.hoisted(() => ({
  mockGetSessionIdentityFromHeaders: vi.fn(),
  mockReadAuthorizationState: vi.fn(),
  mockQueryOne: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  mockHeaders: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

vi.mock('next/headers', () => ({
  headers: mockHeaders,
}));

vi.mock('@/lib/auth/clerk-session', () => ({
  getSessionIdentityFromHeaders: mockGetSessionIdentityFromHeaders,
}));

vi.mock('@/lib/auth/authorization-state', () => ({
  readAuthorizationState: mockReadAuthorizationState,
}));

vi.mock('@/lib/db/client', () => ({
  queryOne: mockQueryOne,
}));

const identity = { userId: 'user-123', clerkUserId: 'clerk_123', sessionId: 'sess_123' };

describe('verifyAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
    mockGetSessionIdentityFromHeaders.mockResolvedValue(identity);
    mockReadAuthorizationState.mockResolvedValue({
      is_admin: true,
      is_disabled: false,
      has_consent: true,
    });
    mockQueryOne.mockResolvedValue({ email: 'admin@example.com' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the authenticated user when their profile is marked admin', async () => {
    const result = await verifyAdmin();
    expect(result.id).toBe('user-123');
    expect(result.email).toBe('admin@example.com');
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated users to login', async () => {
    mockGetSessionIdentityFromHeaders.mockResolvedValueOnce(null);

    await expect(verifyAdmin()).rejects.toThrow('redirect:/login');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  it('redirects users whose admin profile lookup fails', async () => {
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
