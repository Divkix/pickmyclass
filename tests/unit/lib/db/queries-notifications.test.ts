import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { deleteNotificationRecords, resetNotificationsForSection } from '@/lib/db/queries';

// Mock the Hyperdrive-backed db client seam (replaces the former Supabase service client)
const { mockCallFunctionScalar, mockQuery, mockExecute } = vi.hoisted(() => ({
  mockCallFunctionScalar: vi.fn(),
  mockQuery: vi.fn(),
  mockExecute: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  callFunction: vi.fn(),
  callFunctionScalar: mockCallFunctionScalar,
  query: mockQuery,
  queryOne: vi.fn(),
  queryScalar: vi.fn(),
  execute: mockExecute,
  getClient: vi.fn(),
  setConnectionStringGetter: vi.fn(),
}));

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resetNotificationsForSection (characterization)', () => {
  it('no watches found → early return, no delete call', async () => {
    mockQuery.mockResolvedValue([]);

    await expect(
      resetNotificationsForSection({ class_nbr: '12345', term: '2261' }, 'seat_available')
    ).resolves.toBeUndefined();

    // Only the class_watches fetch happens; no delete is invoked.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('watch-fetch error → throws "Failed to reset notifications"', async () => {
    mockQuery.mockRejectedValue(new Error('Connection error'));

    await expect(
      resetNotificationsForSection({ class_nbr: '12345', term: '2261' })
    ).rejects.toThrow('Failed to reset notifications: Connection error');
  });

  it('delete error → throws "Failed to reset notifications"', async () => {
    mockQuery.mockResolvedValue([{ id: 'watch-1' }, { id: 'watch-2' }]);
    mockExecute.mockRejectedValue(new Error('delete blew up'));

    await expect(
      resetNotificationsForSection({ class_nbr: '12345', term: '2261' }, 'seat_available')
    ).rejects.toThrow('Failed to reset notifications: delete blew up');
  });
});

describe('deleteNotificationRecords (characterization)', () => {
  it('empty watchIds → returns 0 without calling rpc', async () => {
    const result = await deleteNotificationRecords([], 'seat_available');

    expect(result).toBe(0);
    expect(mockCallFunctionScalar).not.toHaveBeenCalled();
  });

  it('rpc error → throws "Failed to delete notification records"', async () => {
    mockCallFunctionScalar.mockRejectedValue(new Error('rpc failed'));

    await expect(
      deleteNotificationRecords(['watch-1', 'watch-2'], 'seat_available')
    ).rejects.toThrow('Failed to delete notification records: rpc failed');

    expect(mockCallFunctionScalar).toHaveBeenCalledWith('delete_notification_records', [
      ['watch-1', 'watch-2'],
      'seat_available',
    ]);
  });
});
