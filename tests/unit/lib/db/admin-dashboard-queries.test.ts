import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

// Mock the Hyperdrive-backed db client seam (replaces the former Supabase
// service client). The dashboard helpers map onto:
//   getTotalEmailsSent / getAdminCount        → queryScalar
//   getTotalUsers / getTotalClassesWatched    → callFunctionScalar
//   getUserWatches                            → query (class_watches then class_states)
//   getUsersPage / getClassesPage             → callFunction
const { mockCallFunction, mockCallFunctionScalar, mockQuery, mockQueryScalar } = vi.hoisted(() => ({
  mockCallFunction: vi.fn(),
  mockCallFunctionScalar: vi.fn(),
  mockQuery: vi.fn(),
  mockQueryScalar: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  callFunction: mockCallFunction,
  callFunctionScalar: mockCallFunctionScalar,
  query: mockQuery,
  queryOne: vi.fn(),
  queryScalar: mockQueryScalar,
  execute: vi.fn(),
  getClient: vi.fn(),
  setConnectionStringGetter: vi.fn(),
}));

// Disable the TTL cache so each test exercises the real fetch path rather than
// hitting a module-level cache populated by a previous test.
vi.mock('@/lib/cache/ttl-cache', () => ({
  TtlCache: class {
    get(_key: string) {
      return undefined;
    }
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: mock mirrors TTL cache which stores unknown decoded at boundary
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

describe('admin dashboard query helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    // queryScalar: getTotalEmailsSent (notifications_sent) + getAdminCount (user_profiles)
    mockQueryScalar.mockImplementation((text: string) => {
      if (text.includes('notifications_sent')) return Promise.resolve(9);
      if (text.includes('user_profiles')) return Promise.resolve(1);
      return Promise.resolve(0);
    });
    // callFunctionScalar: getTotalUsers + getTotalClassesWatched
    mockCallFunctionScalar.mockImplementation((name: string) => {
      if (name === 'count_all_users') return Promise.resolve(2);
      if (name === 'count_distinct_classes_watched') return Promise.resolve(2);
      return Promise.resolve(0);
    });
    // query: getUserWatches (class_watches SELECT then class_states SELECT)
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('class_watches')) return Promise.resolve(watches);
      if (text.includes('class_states')) return Promise.resolve(classStates);
      return Promise.resolve([]);
    });

    await expect(getTotalEmailsSent()).resolves.toBe(9);

    // getTotalUsers now uses count_all_users RPC instead of auth.admin.listUsers
    await expect(getTotalUsers()).resolves.toBe(2);

    await expect(getAdminCount()).resolves.toBe(1);

    // getTotalClassesWatched now uses count_distinct_classes_watched RPC
    await expect(getTotalClassesWatched()).resolves.toBe(2);
    // Confirm it does NOT scan class_watches via the query seam.
    const classWatchCalls = mockQuery.mock.calls.filter((c) =>
      String(c[0]).includes('class_watches')
    );
    // getUserWatches (below) is the only class_watches reader in this test; at
    // this point none should have run yet.
    expect(classWatchCalls.length).toBe(0);

    const userWatches = await getUserWatches('user-2');
    expect(userWatches).toHaveLength(3);
    expect(userWatches[0].class_state).toMatchObject({ class_nbr: '12345' });
  });

  it('returns an empty user watch list without querying class states when the user has no watches', async () => {
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('class_watches')) return Promise.resolve([]);
      if (text.includes('class_states')) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    await expect(getUserWatches('user-without-watches')).resolves.toEqual([]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
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

    mockCallFunction.mockResolvedValueOnce(pageRows);

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

    expect(mockCallFunction).toHaveBeenCalledWith('get_users_page', [
      2,
      10,
      'one',
      'user',
      'verified',
      '1-5',
      'email',
      'asc',
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].email).toBe('one@example.com');
    expect(result.rows[0].watch_count).toBe(2);
    expect(result.total).toBe(42);
  });

  it('getUsersPage returns empty page when RPC returns no rows', async () => {
    mockCallFunction.mockResolvedValueOnce([]);

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

    mockCallFunction.mockResolvedValueOnce(pageRows);

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

    expect(mockCallFunction).toHaveBeenCalledWith('get_classes_page', [
      3,
      50,
      'cse',
      'CSE',
      'limited',
      'named',
      '6-10',
      'seats_available',
      'asc',
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].class_nbr).toBe('12345');
    expect(result.rows[0].watcher_count).toBe(7);
    expect(result.total).toBe(99);
  });

  it('getClassesPage returns empty page when RPC returns no rows', async () => {
    mockCallFunction.mockResolvedValueOnce([]);

    const result = await getClassesPage();
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('getTotalClassesWatched uses count_distinct_classes_watched RPC (no full select)', async () => {
    mockCallFunctionScalar.mockResolvedValueOnce(17);

    const count = await getTotalClassesWatched();
    expect(count).toBe(17);
    expect(mockCallFunctionScalar).toHaveBeenCalledWith('count_distinct_classes_watched');
    // Must NOT do a full table scan via the query seam.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('getTotalUsers uses count_all_users RPC (no auth.admin.listUsers walk)', async () => {
    mockCallFunctionScalar.mockResolvedValueOnce(500);

    const count = await getTotalUsers();
    expect(count).toBe(500);
    expect(mockCallFunctionScalar).toHaveBeenCalledWith('count_all_users');
  });
});
