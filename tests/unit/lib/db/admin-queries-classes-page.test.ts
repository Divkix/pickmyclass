import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    rpc: (name: string, params: Record<string, string | number | boolean | null | undefined>) =>
      mockRpc(name, params),
    from: () => {
      throw new Error('from() should not be called by getClassesPage');
    },
  })),
}));

// Import after mocks are registered
import { getClassesPage } from '@/lib/db/admin-queries';

function classPageRow(
  overrides: Record<string, string | number | boolean | null | undefined> = {}
) {
  return {
    id: 'state-1',
    class_nbr: '12345',
    term: '2267',
    subject: 'CSE',
    catalog_nbr: '240',
    title: 'Intro to Programming',
    instructor_name: 'Dr. X',
    seats_available: 0,
    seats_capacity: 30,
    non_reserved_seats: null,
    location: null,
    meeting_times: null,
    last_checked_at: '2026-08-01T00:00:00Z',
    last_changed_at: '2026-08-01T00:00:00Z',
    watcher_count: 3,
    seat_emails: 2,
    instructor_emails: 1,
    total_count: 2,
    total_watchers: 7,
    full_classes: 1,
    ...overrides,
  };
}

describe('getClassesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls get_classes_page RPC and returns rows, total, and the global aggregates', async () => {
    const rows = [
      classPageRow({ id: 'state-1' }),
      classPageRow({
        id: 'state-2',
        class_nbr: '67890',
        subject: 'MAT',
        seats_available: 12,
        watcher_count: 4,
        seat_emails: 1,
        instructor_emails: 0,
      }),
    ];
    mockRpc.mockResolvedValue({ data: rows, error: null });

    const result = await getClassesPage({
      page: 2,
      pageSize: 25,
      search: 'cse',
      subject: 'CSE',
      seatStatus: 'all',
      instructor: 'all',
      watcherCount: 'all',
      sort: 'watcher_count',
      dir: 'asc',
    });

    expect(mockRpc).toHaveBeenCalledWith('get_classes_page', {
      p_page: 2,
      p_page_size: 25,
      p_search: 'cse',
      p_subject: 'CSE',
      p_seat_status: 'all',
      p_instructor: 'all',
      p_watcher_count: 'all',
      p_sort: 'watcher_count',
      p_dir: 'asc',
    });

    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(2);
    // Global aggregates are read off every row (window-function broadcast),
    // and surfaced page-independently on the result.
    expect(result.totalWatchers).toBe(7);
    expect(result.fullClasses).toBe(1);
    expect(result.rows[0]).toMatchObject({
      id: 'state-1',
      watcher_count: 3,
      seat_emails: 2,
      instructor_emails: 1,
    });
  });

  it('defaults aggregates to 0 when the RPC returns no rows', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await getClassesPage();

    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalWatchers).toBe(0);
    expect(result.fullClasses).toBe(0);
  });

  it('guards against a missing aggregate column (function-version skew) with 0, never NaN', async () => {
    // Old function definition shape: rows carry total_count but no
    // total_watchers / full_classes yet. Cast through an index signature so the
    // keys can be deleted (they are required on the generated row type).
    // SAFETY: test widens row to generic dictionary to simulate missing columns for version-skew guard
    const row = classPageRow() as Record<string, string | number | boolean | null | undefined>;
    delete row.total_watchers;
    delete row.full_classes;
    mockRpc.mockResolvedValue({ data: [row], error: null });

    const result = await getClassesPage();

    expect(Number.isNaN(result.totalWatchers)).toBe(false);
    expect(Number.isNaN(result.fullClasses)).toBe(false);
    expect(result.totalWatchers).toBe(0);
    expect(result.fullClasses).toBe(0);
  });

  it('throws when the RPC fails', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Database connection failed' },
    });

    await expect(getClassesPage()).rejects.toThrow(
      'Failed to fetch classes page: Database connection failed'
    );
  });
});
