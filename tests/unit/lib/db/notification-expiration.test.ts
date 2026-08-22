import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { resetNotificationsForSection, tryRecordNotificationsBatch } from '@/lib/db/queries';

// Mock the Hyperdrive-backed db client seam (replaces the former Supabase service client)
const { mockCallFunction, mockQuery, mockExecute } = vi.hoisted(() => ({
  mockCallFunction: vi.fn(),
  mockQuery: vi.fn(),
  mockExecute: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  callFunction: mockCallFunction,
  callFunctionScalar: vi.fn(),
  query: mockQuery,
  queryOne: vi.fn(),
  queryScalar: vi.fn(),
  execute: mockExecute,
  getClient: vi.fn(),
  setConnectionStringGetter: vi.fn(),
}));

describe('Notification Expiration (Issue #157)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('tryRecordNotificationsBatch', () => {
    it('should record notifications for new watch IDs', async () => {
      const watchIds = ['watch-1', 'watch-2'];
      mockCallFunction.mockResolvedValue([
        { try_record_notifications_batch: ['watch-1', 'watch-2'] },
      ]);

      const result = await tryRecordNotificationsBatch(watchIds, 'seat_available');

      expect(result).toEqual(new Set(['watch-1', 'watch-2']));
      expect(mockCallFunction).toHaveBeenCalledWith('try_record_notifications_batch', [
        watchIds,
        'seat_available',
        24,
      ]);
    });

    it('should handle instructor_assigned notification type', async () => {
      const watchIds = ['watch-1'];
      mockCallFunction.mockResolvedValue([{ try_record_notifications_batch: ['watch-1'] }]);

      const result = await tryRecordNotificationsBatch(watchIds, 'instructor_assigned', 48);

      expect(result).toEqual(new Set(['watch-1']));
      expect(mockCallFunction).toHaveBeenCalledWith('try_record_notifications_batch', [
        watchIds,
        'instructor_assigned',
        48,
      ]);
    });

    it('should return empty set when all notifications are already recorded', async () => {
      const watchIds = ['watch-1', 'watch-2'];
      mockCallFunction.mockResolvedValue([{ try_record_notifications_batch: [] }]);

      const result = await tryRecordNotificationsBatch(watchIds, 'seat_available');

      expect(result).toEqual(new Set());
    });

    it('should return only newly recorded watch IDs', async () => {
      const watchIds = ['watch-1', 'watch-2', 'watch-3'];
      mockCallFunction.mockResolvedValue([{ try_record_notifications_batch: ['watch-2'] }]);

      const result = await tryRecordNotificationsBatch(watchIds, 'seat_available');

      expect(result).toEqual(new Set(['watch-2']));
    });

    it('should handle empty watch IDs array', async () => {
      const result = await tryRecordNotificationsBatch([], 'seat_available');

      expect(result).toEqual(new Set());
      expect(mockCallFunction).not.toHaveBeenCalled();
    });

    it('should throw error when RPC fails', async () => {
      const watchIds = ['watch-1'];
      mockCallFunction.mockRejectedValue(new Error('Database error'));

      await expect(tryRecordNotificationsBatch(watchIds, 'seat_available')).rejects.toThrow(
        'Failed to batch record notifications: Database error'
      );
    });

    it('should use default expiration of 24 hours', async () => {
      mockCallFunction.mockResolvedValue([{ try_record_notifications_batch: ['watch-1'] }]);

      await tryRecordNotificationsBatch(['watch-1'], 'seat_available');

      expect(mockCallFunction).toHaveBeenCalledWith('try_record_notifications_batch', [
        ['watch-1'],
        'seat_available',
        24,
      ]);
    });
  });

  describe('resetNotificationsForSection', () => {
    it('should reset seat_available notifications for a section', async () => {
      mockQuery.mockResolvedValue([{ id: 'watch-1' }, { id: 'watch-2' }]);
      mockExecute.mockResolvedValue(2);

      await resetNotificationsForSection({ class_nbr: '12345', term: '2261' }, 'seat_available');

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('class_watches'), [
        '12345',
        '2261',
      ]);
    });

    it('should throw error when fetching watches fails', async () => {
      mockQuery.mockRejectedValue(new Error('Connection error'));

      await expect(
        resetNotificationsForSection({ class_nbr: '12345', term: '2261' })
      ).rejects.toThrow('Failed to reset notifications: Connection error');
    });

    it('should do nothing when no watches found', async () => {
      mockQuery.mockResolvedValue([]);

      await resetNotificationsForSection({ class_nbr: '12345', term: '2261' }, 'seat_available');

      // Should not call delete when no watches found
      expect(mockExecute).not.toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should handle instructor_assigned notification type', async () => {
      mockQuery.mockResolvedValue([{ id: 'watch-1' }]);
      mockExecute.mockResolvedValue(1);

      await resetNotificationsForSection(
        { class_nbr: '12345', term: '2261' },
        'instructor_assigned'
      );

      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('notifications_sent'), [
        ['watch-1'],
        'instructor_assigned',
      ]);
    });

    it('should use seat_available as default notification type', async () => {
      mockQuery.mockResolvedValue([{ id: 'watch-1' }]);
      mockExecute.mockResolvedValue(1);

      await resetNotificationsForSection({ class_nbr: '12345', term: '2261' });

      // Should default to seat_available
      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('notifications_sent'), [
        ['watch-1'],
        'seat_available',
      ]);
    });

    it('should filter by both class_nbr and term', async () => {
      mockQuery.mockResolvedValue([{ id: 'watch-1' }]);
      mockExecute.mockResolvedValue(1);

      await resetNotificationsForSection({ class_nbr: '12345', term: '2261' });

      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['12345', '2261']);
    });
  });

  describe('Notification Expiration Edge Cases', () => {
    it('should handle batch notification recording with custom expiration', async () => {
      const watchIds = ['watch-1', 'watch-2', 'watch-3'];
      mockCallFunction.mockResolvedValue([
        { try_record_notifications_batch: ['watch-1', 'watch-2', 'watch-3'] },
      ]);

      const result = await tryRecordNotificationsBatch(watchIds, 'seat_available', 48);

      expect(result.size).toBe(3);
      expect(mockCallFunction).toHaveBeenCalledWith('try_record_notifications_batch', [
        watchIds,
        'seat_available',
        48,
      ]);
    });

    it('should handle partial success in batch recording', async () => {
      const watchIds = ['watch-1', 'watch-2', 'watch-3'];
      mockCallFunction.mockResolvedValue([
        { try_record_notifications_batch: ['watch-1', 'watch-3'] },
      ]);

      const result = await tryRecordNotificationsBatch(watchIds, 'instructor_assigned');

      expect(result).toEqual(new Set(['watch-1', 'watch-3']));
    });
  });
});
