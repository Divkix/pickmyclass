import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: mock mirrors Supabase rpc which accepts unknown params decoded at boundary
    rpc: (name: string, params: unknown) => mockRpc(name, params),
    from: (table: string) => mockFrom(table),
  })),
}));

// Import after mocks are registered
import { getRecentActivity, getUserWatches } from '@/lib/db/admin-queries';

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

describe('getUserWatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Wire the service-client `from()` mock: `class_watches` resolves the watch
   * list, `class_states` resolves the joined states.
   */
  function mockTables(watches: unknown[], states: unknown[]) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'class_watches') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: watches, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          in: () => Promise.resolve({ data: states, error: null }),
        }),
      };
    });
  }

  it('joins each watch to its own term state when a class_nbr spans two terms', async () => {
    // Same class_nbr in two terms — allowed by the (user_id, term, class_nbr)
    // uniqueness. Keyed by class_nbr alone, one term's state would overwrite
    // the other's.
    mockTables(
      [
        {
          id: 'w-spring',
          user_id: 'u1',
          class_nbr: '12345',
          term: '2261',
          subject: 'CSE',
          catalog_nbr: '110',
          created_at: '2026-01-10T00:00:00Z',
        },
        {
          id: 'w-fall',
          user_id: 'u1',
          class_nbr: '12345',
          term: '2267',
          subject: 'CSE',
          catalog_nbr: '110',
          created_at: '2026-01-11T00:00:00Z',
        },
      ],
      [
        { class_nbr: '12345', term: '2261', seats_available: 5, seats_capacity: 40 },
        { class_nbr: '12345', term: '2267', seats_available: 0, seats_capacity: 40 },
      ]
    );

    const result = await getUserWatches('u1');

    expect(result).toHaveLength(2);
    const spring = result.find((w) => w.id === 'w-spring');
    const fall = result.find((w) => w.id === 'w-fall');
    expect(spring?.class_state?.term).toBe('2261');
    expect(spring?.class_state?.seats_available).toBe(5);
    expect(fall?.class_state?.term).toBe('2267');
    expect(fall?.class_state?.seats_available).toBe(0);
  });

  it('returns null class_state for a watch whose term has no matching state row', async () => {
    mockTables(
      [
        {
          id: 'w-fall',
          user_id: 'u1',
          class_nbr: '12345',
          term: '2267',
          subject: 'CSE',
          catalog_nbr: '110',
          created_at: '2026-01-11T00:00:00Z',
        },
      ],
      // Only the spring term's state exists; the fall watch must not borrow it.
      [{ class_nbr: '12345', term: '2261', seats_available: 5, seats_capacity: 40 }]
    );

    const result = await getUserWatches('u1');

    expect(result).toHaveLength(1);
    expect(result[0].class_state).toBeNull();
  });
});
