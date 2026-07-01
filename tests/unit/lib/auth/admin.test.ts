import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { verifyAdmin } from '@/lib/auth/admin';

const { mockCreateClient, mockGetUser, mockRedirect, mockSingle } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockGetUser: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  mockSingle: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

const user = { id: 'user-123', email: 'admin@example.com' };

describe('verifyAdmin', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ data: { user }, error: null });
    mockSingle.mockResolvedValue({ data: { is_admin: true }, error: null });
    mockCreateClient.mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: mockSingle,
            maybeSingle: mockSingle,
          })),
        })),
      })),
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
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
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

    await expect(verifyAdmin()).rejects.toThrow('redirect:/dashboard');
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
  });

  it('redirects authenticated non-admin users', async () => {
    mockSingle.mockResolvedValueOnce({ data: { is_admin: false }, error: null });

    await expect(verifyAdmin()).rejects.toThrow('redirect:/dashboard');
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
  });
});
