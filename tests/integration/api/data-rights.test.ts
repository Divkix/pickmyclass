import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const {
  mockCreateClient,
  mockGetServiceClient,
  mockGetUser,
  mockInvalidateProfileCache,
  mockProfileSingle,
  mockServiceEq,
  mockServiceUpdate,
  mockSignOut,
  mockWatchesOrder,
  mockNotificationsOrder,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockGetServiceClient: vi.fn(),
  mockGetUser: vi.fn(),
  mockInvalidateProfileCache: vi.fn(),
  mockProfileSingle: vi.fn(),
  mockServiceEq: vi.fn(),
  mockServiceUpdate: vi.fn(),
  mockSignOut: vi.fn(),
  mockWatchesOrder: vi.fn(),
  mockNotificationsOrder: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: mockGetServiceClient,
}));

vi.mock('@/proxy', () => ({
  invalidateProfileCache: mockInvalidateProfileCache,
}));

import { DELETE } from '@/app/api/user/delete/route';
import { GET } from '@/app/api/user/export/route';

const user = {
  id: 'user-123',
  email: 'student@example.com',
  created_at: '2026-05-01T00:00:00Z',
  last_sign_in_at: '2026-05-19T00:00:00Z',
  email_confirmed_at: '2026-05-02T00:00:00Z',
};

const profile = {
  age_verified_at: '2026-05-01T00:00:00Z',
  agreed_to_terms_at: '2026-05-01T00:00:00Z',
  is_disabled: false,
  disabled_at: null,
};

function createTableClient() {
  return {
    auth: {
      getUser: mockGetUser,
      signOut: mockSignOut,
    },
    from: vi.fn((table: string) => {
      if (table === 'user_profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: mockProfileSingle,
            })),
          })),
        };
      }

      if (table === 'class_watches') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: mockWatchesOrder,
            })),
          })),
        };
      }

      if (table === 'notifications_sent') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: mockNotificationsOrder,
            })),
          })),
        };
      }

      throw new Error(`Unexpected table queried in test mock: ${table}`);
    }),
  };
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('user data rights APIs', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCreateClient.mockResolvedValue(createTableClient());
    mockGetUser.mockResolvedValue({ data: { user }, error: null });
    mockProfileSingle.mockResolvedValue({ data: profile, error: null });
    mockWatchesOrder.mockResolvedValue({
      data: [{ id: 'watch-1', class_nbr: '12345', created_at: '2026-05-10T00:00:00Z' }],
      error: null,
    });
    mockNotificationsOrder.mockResolvedValue({
      data: [{ id: 'notification-1', sent_at: '2026-05-11T00:00:00Z' }],
      error: null,
    });
    mockServiceUpdate.mockReturnValue({ eq: mockServiceEq });
    mockServiceEq.mockResolvedValue({ error: null });
    mockGetServiceClient.mockReturnValue({
      from: vi.fn(() => ({
        update: mockServiceUpdate,
      })),
    });
    mockSignOut.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('rejects data exports for unauthenticated users', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'no session' } });

    const response = await GET();
    const data = await json(response);

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  it('exports account, profile, watch, and notification data as an attachment', async () => {
    const response = await GET();
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toMatch(
      /pickmyclass-data-\d{4}-\d{2}-\d{2}\.json/
    );
    expect(data.user_account).toMatchObject({ email: 'student@example.com' });
    expect(data.profile).toMatchObject({ account_status: 'active' });
    expect(data.summary).toMatchObject({
      total_watches: 1,
      total_notifications: 1,
      active_watches: 1,
    });
  });

  it('returns a 500 response when export generation throws', async () => {
    mockCreateClient.mockRejectedValueOnce(new Error('supabase unavailable'));

    const response = await GET();
    const data = await json(response);

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to export data');
  });

  it('rejects account deletion for unauthenticated users', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'no session' } });

    const response = await DELETE();
    const data = await json(response);

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  it('soft-deletes authenticated accounts and invalidates cached profiles', async () => {
    const response = await DELETE();
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.disabled_at).toEqual(expect.any(String));
    expect(data.permanent_deletion_date).toEqual(expect.any(String));
    expect(mockServiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        is_disabled: true,
        notifications_enabled: false,
      })
    );
    expect(mockServiceEq).toHaveBeenCalledWith('user_id', 'user-123');
    expect(mockInvalidateProfileCache).toHaveBeenCalledWith('user-123');
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('fails account deletion when the soft delete update fails', async () => {
    mockServiceEq.mockResolvedValueOnce({ error: { message: 'update failed' } });

    const response = await DELETE();
    const data = await json(response);

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to delete account');
    expect(mockInvalidateProfileCache).not.toHaveBeenCalled();
  });

  it('still completes account deletion when sign out fails', async () => {
    mockSignOut.mockResolvedValueOnce({ error: { message: 'signout failed' } });

    const response = await DELETE();
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('returns a 500 response when account deletion throws', async () => {
    mockGetServiceClient.mockImplementationOnce(() => {
      throw new Error('service unavailable');
    });

    const response = await DELETE();
    const data = await json(response);

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to delete account');
  });
});
