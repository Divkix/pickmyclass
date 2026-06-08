import type { User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const { mockServiceClient } = vi.hoisted(() => ({
  mockServiceClient: {
    auth: {
      admin: {
        listUsers: vi.fn(),
      },
    },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => mockServiceClient),
}));

import {
  getAdminCount,
  getAllClassesWithWatchers,
  getAllUsersWithWatchCount,
  getTotalClassesWatched,
  getTotalEmailsSent,
  getTotalUsers,
  getUserWatches,
} from '@/lib/db/admin-queries';

function countQuery(count: number, error: Error | null = null) {
  return {
    select: vi.fn(() => Promise.resolve({ count, error })),
  };
}

function dataQuery(data: unknown, error: Error | null = null) {
  const result = Promise.resolve({ data, error });
  const builder = {
    order: vi.fn(() => result),
    eq: vi.fn(() => builder),
    in: vi.fn(() => result),
  };
  // oxlint-disable-next-line unicorn/no-thenable
  Object.defineProperty(builder, 'then', { value: result.then.bind(result) });
  Object.defineProperty(builder, 'catch', { value: result.catch.bind(result) });
  Object.defineProperty(builder, 'finally', { value: result.finally.bind(result) });

  return {
    select: vi.fn(() => builder),
  };
}

const users = [
  {
    id: 'user-1',
    email: 'one@example.com',
    created_at: '2026-05-01T00:00:00Z',
    last_sign_in_at: '2026-05-03T00:00:00Z',
    email_confirmed_at: '2026-05-02T00:00:00Z',
  },
  {
    id: 'user-2',
    email: 'two@example.com',
    created_at: '2026-05-04T00:00:00Z',
    last_sign_in_at: null,
    email_confirmed_at: null,
  },
] as User[];

describe('admin dashboard query helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServiceClient.auth.admin.listUsers.mockResolvedValue({
      data: { users },
      error: null,
    });
  });

  it('collects dashboard counts, class watcher rows, user rows, and user watch details', async () => {
    const classStates = [
      {
        id: 'state-1',
        class_nbr: '12345',
        term: '2261',
        subject: 'CSE',
        catalog_nbr: '240',
        title: 'Intro to Programming',
        instructor_name: 'Prof One',
        seats_available: 2,
        seats_capacity: 40,
        non_reserved_seats: null,
        location: 'Tempe',
        meeting_times: 'MWF',
        last_checked_at: '2026-05-01T00:00:00Z',
        last_changed_at: '2026-05-01T00:00:00Z',
      },
      {
        id: 'state-2',
        class_nbr: '67890',
        term: '2261',
        subject: 'MAT',
        catalog_nbr: '265',
        title: 'Calculus',
        instructor_name: 'Prof Two',
        seats_available: 0,
        seats_capacity: 80,
        non_reserved_seats: null,
        location: 'Online',
        meeting_times: 'TTH',
        last_checked_at: '2026-05-01T00:00:00Z',
        last_changed_at: '2026-05-01T00:00:00Z',
      },
    ];

    const watches = [
      { id: 'watch-1', user_id: 'user-1', class_nbr: '12345' },
      { id: 'watch-2', user_id: 'user-2', class_nbr: '12345' },
      { id: 'watch-3', user_id: 'user-2', class_nbr: '67890' },
    ];

    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === 'notifications_sent') return countQuery(9);
      if (table === 'user_profiles') {
        return {
          select: vi.fn((_columns: string, options?: { count?: string; head?: boolean }) => {
            if (options?.count) {
              return {
                eq: vi.fn(() => Promise.resolve({ count: 1, error: null })),
              };
            }

            return Promise.resolve({
              data: [
                { user_id: 'user-1', is_admin: true },
                { user_id: 'user-2', is_admin: false },
              ],
              error: null,
            });
          }),
        };
      }
      if (table === 'class_watches') return dataQuery(watches);
      if (table === 'class_states') return dataQuery(classStates);
      throw new Error(`Unexpected table ${table}`);
    });

    mockServiceClient.rpc.mockImplementation((name: string) => {
      if (name === 'get_notification_counts_by_class') {
        return Promise.resolve({
          data: [{ class_nbr: '12345', seat_emails: 4, instructor_emails: 1 }],
          error: null,
        });
      }
      if (name === 'get_notification_counts_by_user') {
        return Promise.resolve({
          data: [{ user_id: 'user-2', seat_emails: 3, instructor_emails: 2 }],
          error: null,
        });
      }
      if (name === 'get_user_engagement_stats') {
        return Promise.resolve({
          data: [
            {
              user_id: 'user-2',
              engagement_emails_sent: 5,
              engagement_emails_opened: 4,
              engagement_rate: 0.8,
              engagement_status: 'healthy',
            },
          ],
          error: null,
        });
      }
      throw new Error(`Unexpected RPC ${name}`);
    });

    await expect(getTotalEmailsSent()).resolves.toBe(9);
    await expect(getTotalUsers()).resolves.toBe(2);
    await expect(getAdminCount()).resolves.toBe(1);
    await expect(getTotalClassesWatched()).resolves.toBe(2);

    const classes = await getAllClassesWithWatchers();
    expect(classes).toMatchObject([
      {
        class_nbr: '12345',
        watcher_count: 2,
        seat_emails: 4,
        instructor_emails: 1,
      },
      {
        class_nbr: '67890',
        watcher_count: 1,
        seat_emails: 0,
        instructor_emails: 0,
      },
    ]);

    const usersWithCounts = await getAllUsersWithWatchCount();
    expect(usersWithCounts).toMatchObject([
      {
        id: 'user-2',
        email: 'two@example.com',
        watch_count: 2,
        is_admin: false,
        seat_emails: 3,
        instructor_emails: 2,
        engagement_emails_sent: 5,
        engagement_emails_opened: 4,
        engagement_rate: 0.8,
        engagement_status: 'healthy',
      },
      {
        id: 'user-1',
        email: 'one@example.com',
        watch_count: 1,
        is_admin: true,
        engagement_status: 'new',
      },
    ]);

    const userWatches = await getUserWatches('user-2');
    expect(userWatches).toHaveLength(3);
    expect(userWatches[0].class_state).toMatchObject({ class_nbr: '12345' });
  });

  it('returns an empty user watch list without querying class states when the user has no watches', async () => {
    mockServiceClient.from.mockImplementation((table: string) => {
      if (table === 'class_watches') return dataQuery([]);
      if (table === 'class_states') return dataQuery([]);
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(getUserWatches('user-without-watches')).resolves.toEqual([]);
    expect(mockServiceClient.from).toHaveBeenCalledTimes(1);
  });
});
