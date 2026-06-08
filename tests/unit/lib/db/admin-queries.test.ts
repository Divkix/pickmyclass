import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    rpc: (name: string, params: unknown) => mockRpc(name, params),
  })),
}));

// Import after mocks are registered
import { getRecentActivity } from '@/lib/db/admin-queries';

describe('getRecentActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return discriminated union items for all activity types', async () => {
    const mockData = [
      {
        activity_type: 'user_registration',
        activity_at: '2026-05-19T10:00:00Z',
        user_email: 'alice@example.com',
        class_nbr: null,
        subject: null,
        catalog_nbr: null,
        notification_type: null,
      },
      {
        activity_type: 'new_watch',
        activity_at: '2026-05-19T09:30:00Z',
        user_email: 'bob@example.com',
        class_nbr: '12431',
        subject: 'CSE',
        catalog_nbr: '240',
        notification_type: null,
      },
      {
        activity_type: 'email_sent',
        activity_at: '2026-05-19T09:00:00Z',
        user_email: 'charlie@example.com',
        class_nbr: '12431',
        subject: 'CSE',
        catalog_nbr: '240',
        notification_type: 'seat_available',
      },
    ];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const result = await getRecentActivity(10);

    expect(mockRpc).toHaveBeenCalledWith('get_recent_activity', {
      p_limit: 10,
    });

    expect(result).toHaveLength(3);

    expect(result[0]).toEqual({
      type: 'user_registration',
      activityAt: '2026-05-19T10:00:00Z',
      userEmail: 'alice@example.com',
      classNbr: null,
      subject: null,
      catalogNbr: null,
      notificationType: null,
    });

    expect(result[1]).toEqual({
      type: 'new_watch',
      activityAt: '2026-05-19T09:30:00Z',
      userEmail: 'bob@example.com',
      classNbr: '12431',
      subject: 'CSE',
      catalogNbr: '240',
      notificationType: null,
    });

    expect(result[2]).toEqual({
      type: 'email_sent',
      activityAt: '2026-05-19T09:00:00Z',
      userEmail: 'charlie@example.com',
      classNbr: '12431',
      subject: 'CSE',
      catalogNbr: '240',
      notificationType: 'seat_available',
    });
  });

  it('should use default limit of 50 when none provided', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    await getRecentActivity();

    expect(mockRpc).toHaveBeenCalledWith('get_recent_activity', {
      p_limit: 50,
    });
  });

  it('should return empty array when no activity exists', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await getRecentActivity(15);

    expect(mockRpc).toHaveBeenCalledWith('get_recent_activity', {
      p_limit: 15,
    });
    expect(result).toEqual([]);
  });

  it('should degrade to an empty activity feed when the recent activity RPC is not deployed', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message:
          'Could not find the function public.get_recent_activity(p_limit) in the schema cache',
      },
    });

    const result = await getRecentActivity(42);
    const cachedResult = await getRecentActivity(42);

    expect(mockRpc).toHaveBeenCalledWith('get_recent_activity', {
      p_limit: 42,
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
    expect(cachedResult).toEqual([]);
  });

  it('should throw error when RPC fails', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Database connection failed' },
    });

    await expect(getRecentActivity(20)).rejects.toThrow(
      'Failed to fetch recent activity: Database connection failed'
    );
  });
});
