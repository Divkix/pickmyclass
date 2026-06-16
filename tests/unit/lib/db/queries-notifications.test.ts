import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { deleteNotificationRecords, resetNotificationsForSection } from '@/lib/db/queries';

// Mock Supabase service client
const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    rpc: mockRpc,
    from: mockFrom,
  })),
}));

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Build a mock `from('class_watches').select(...).eq(...).eq(...)` chain that resolves
 * with the given watch-fetch result when the second `.eq('term', ...)` call happens.
 */
function mockWatchFetch(result: {
  data: Array<{ id: string }> | null;
  error: { message: string } | null;
}) {
  const selectQuery = { eq: vi.fn() };
  selectQuery.eq.mockImplementation((key: string) => {
    if (key === 'term') {
      return Promise.resolve(result);
    }
    return selectQuery;
  });
  return selectQuery;
}

describe('resetNotificationsForSection (characterization)', () => {
  it('no watches found → early return, no delete call', async () => {
    const selectQuery = mockWatchFetch({ data: [], error: null });
    mockFrom.mockReturnValue({ select: vi.fn(() => selectQuery) });

    await expect(
      resetNotificationsForSection('12345', '2261', 'seat_available')
    ).resolves.toBeUndefined();

    // Only the class_watches fetch happens; no delete chain is invoked.
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('class_watches');
  });

  it('watch-fetch error → throws "Failed to fetch watches"', async () => {
    const selectQuery = mockWatchFetch({ data: null, error: { message: 'Connection error' } });
    mockFrom.mockReturnValue({ select: vi.fn(() => selectQuery) });

    await expect(resetNotificationsForSection('12345', '2261')).rejects.toThrow(
      'Failed to fetch watches: Connection error'
    );
  });

  it('delete error → throws "Failed to reset notifications"', async () => {
    const selectQuery = mockWatchFetch({
      data: [{ id: 'watch-1' }, { id: 'watch-2' }],
      error: null,
    });
    const deleteEq = vi.fn().mockResolvedValue({ error: { message: 'delete blew up' } });
    mockFrom.mockReturnValue({
      select: vi.fn(() => selectQuery),
      delete: vi.fn(() => ({
        in: vi.fn(() => ({ eq: deleteEq })),
      })),
    });

    await expect(resetNotificationsForSection('12345', '2261', 'seat_available')).rejects.toThrow(
      'Failed to reset notifications: delete blew up'
    );
  });
});

describe('deleteNotificationRecords (characterization)', () => {
  it('empty watchIds → returns 0 without calling rpc', async () => {
    const result = await deleteNotificationRecords([], 'seat_available');

    expect(result).toBe(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rpc error → throws "Failed to delete notification records"', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'rpc failed' } });

    await expect(
      deleteNotificationRecords(['watch-1', 'watch-2'], 'seat_available')
    ).rejects.toThrow('Failed to delete notification records: rpc failed');

    expect(mockRpc).toHaveBeenCalledWith('delete_notification_records', {
      p_class_watch_ids: ['watch-1', 'watch-2'],
      p_notification_type: 'seat_available',
    });
  });
});
