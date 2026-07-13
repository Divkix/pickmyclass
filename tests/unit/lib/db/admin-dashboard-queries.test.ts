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

// Disable the TTL cache so each test exercises the real fetch path rather than
// hitting a module-level cache populated by a previous test.
vi.mock('@/lib/cache/ttl-cache', () => ({
  TtlCache: class {
    get(_key: string) {
      return undefined;
    }
    set(_key: string, _data: unknown) {}
    clear() {}
    delete(_key: string) {
      return false;
    }
  },
}));

import {
  getAdminCount,
  getClassesPage,
  getTotalClassesWatched,
  getTotalEmailsSent,
  getTotalUsers,
  getUserWatches,
  getUsersPage,
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
      { id: 'watch-1', user_id: 'user-1', class_nbr: '12345', term: '2261' },
      { id: 'watch-2', user_id: 'user-2', class_nbr: '12345', term: '2261' },
      { id: 'watch-3', user_id: 'user-2', class_nbr: '67890', term: '2261' },
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

    mockServiceClient.rpc.mockImplementation((name: string, _args?: unknown) => {
      // New scalar RPCs
      if (name === 'count_all_users') {
        return Promise.resolve({ data: 2, error: null });
      }
      if (name === 'count_distinct_classes_watched') {
        return Promise.resolve({ data: 2, error: null });
      }
      throw new Error(`Unexpected RPC ${name}`);
    });

    await expect(getTotalEmailsSent()).resolves.toBe(9);

    // getTotalUsers now uses count_all_users RPC instead of auth.admin.listUsers
    await expect(getTotalUsers()).resolves.toBe(2);
    expect(mockServiceClient.auth.admin.listUsers).not.toHaveBeenCalled();

    await expect(getAdminCount()).resolves.toBe(1);

    // getTotalClassesWatched now uses count_distinct_classes_watched RPC
    await expect(getTotalClassesWatched()).resolves.toBe(2);
    // Confirm it does NOT call from('class_watches').select('class_nbr')
    const classWatchCalls = (mockServiceClient.from.mock.calls as string[][]).filter(
      (c) => c[0] === 'class_watches'
    );
    expect(classWatchCalls.length).toBe(0);

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

  // ── Paginated RPC wrappers ────────────────────────────────────────────────

  it('getUsersPage calls get_users_page RPC with correct parameters', async () => {
    const pageRows = [
      {
        id: 'user-1',
        email: 'one@example.com',
        created_at: '2026-05-01T00:00:00Z',
        last_sign_in_at: null,
        email_confirmed_at: '2026-05-01T00:00:00Z',
        watch_count: 2,
        is_admin: false,
        seat_emails: 1,
        instructor_emails: 0,
        notification_status: 'active',
        total_count: 42,
      },
    ];

    mockServiceClient.rpc.mockResolvedValueOnce({ data: pageRows, error: null });

    const result = await getUsersPage({
      page: 2,
      pageSize: 10,
      search: 'one',
      role: 'user',
      verified: 'verified',
      watchCount: '1-5',
      sort: 'email',
      dir: 'asc',
    });

    expect(mockServiceClient.rpc).toHaveBeenCalledWith('get_users_page', {
      p_page: 2,
      p_page_size: 10,
      p_search: 'one',
      p_role: 'user',
      p_verified: 'verified',
      p_watch_count: '1-5',
      p_sort: 'email',
      p_dir: 'asc',
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].email).toBe('one@example.com');
    expect(result.rows[0].watch_count).toBe(2);
    expect(result.total).toBe(42);
  });

  it('getUsersPage returns empty page when RPC returns no rows', async () => {
    mockServiceClient.rpc.mockResolvedValueOnce({ data: [], error: null });

    const result = await getUsersPage();
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('getClassesPage calls get_classes_page RPC with correct parameters', async () => {
    const pageRows = [
      {
        id: 'state-1',
        class_nbr: '12345',
        term: '2261',
        subject: 'CSE',
        catalog_nbr: '240',
        title: 'Intro',
        instructor_name: 'Dr. X',
        seats_available: 5,
        seats_capacity: 30,
        non_reserved_seats: null,
        location: null,
        meeting_times: null,
        last_checked_at: '2026-05-01T00:00:00Z',
        last_changed_at: '2026-05-01T00:00:00Z',
        watcher_count: 7,
        seat_emails: 3,
        instructor_emails: 1,
        total_count: 99,
      },
    ];

    mockServiceClient.rpc.mockResolvedValueOnce({ data: pageRows, error: null });

    const result = await getClassesPage({
      page: 3,
      pageSize: 50,
      search: 'cse',
      subject: 'CSE',
      seatStatus: 'limited',
      instructor: 'named',
      watcherCount: '6-10',
      sort: 'seats_available',
      dir: 'asc',
    });

    expect(mockServiceClient.rpc).toHaveBeenCalledWith('get_classes_page', {
      p_page: 3,
      p_page_size: 50,
      p_search: 'cse',
      p_subject: 'CSE',
      p_seat_status: 'limited',
      p_instructor: 'named',
      p_watcher_count: '6-10',
      p_sort: 'seats_available',
      p_dir: 'asc',
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].class_nbr).toBe('12345');
    expect(result.rows[0].watcher_count).toBe(7);
    expect(result.total).toBe(99);
  });

  it('getClassesPage returns empty page when RPC returns no rows', async () => {
    mockServiceClient.rpc.mockResolvedValueOnce({ data: [], error: null });

    const result = await getClassesPage();
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('getTotalClassesWatched uses count_distinct_classes_watched RPC (no full select)', async () => {
    mockServiceClient.rpc.mockResolvedValueOnce({ data: 17, error: null });

    const count = await getTotalClassesWatched();
    expect(count).toBe(17);
    expect(mockServiceClient.rpc).toHaveBeenCalledWith('count_distinct_classes_watched');
    // Must NOT do a full table scan
    expect(mockServiceClient.from).not.toHaveBeenCalled();
  });

  it('getTotalUsers uses count_all_users RPC (no auth.admin.listUsers walk)', async () => {
    mockServiceClient.rpc.mockResolvedValueOnce({ data: 500, error: null });

    const count = await getTotalUsers();
    expect(count).toBe(500);
    expect(mockServiceClient.rpc).toHaveBeenCalledWith('count_all_users');
    expect(mockServiceClient.auth.admin.listUsers).not.toHaveBeenCalled();
  });
});
