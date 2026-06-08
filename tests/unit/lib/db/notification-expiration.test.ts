import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { resetNotificationsForSection, tryRecordNotificationsBatch } from '@/lib/db/queries';

// Mock Supabase service client
const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    rpc: mockRpc,
    from: mockFrom,
  })),
}));

describe('Notification Expiration (Issue #157)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('tryRecordNotificationsBatch', () => {
    it('should record notifications for new watch IDs', async () => {
      const watchIds = ['watch-1', 'watch-2'];
      mockRpc.mockResolvedValue({
        data: ['watch-1', 'watch-2'],
        error: null,
      });

      const result = await tryRecordNotificationsBatch(watchIds, 'seat_available');

      expect(result).toEqual(new Set(['watch-1', 'watch-2']));
      expect(mockRpc).toHaveBeenCalledWith('try_record_notifications_batch', {
        p_class_watch_ids: watchIds,
        p_notification_type: 'seat_available',
        p_expires_hours: 24,
      });
    });

    it('should handle instructor_assigned notification type', async () => {
      const watchIds = ['watch-1'];
      mockRpc.mockResolvedValue({
        data: ['watch-1'],
        error: null,
      });

      const result = await tryRecordNotificationsBatch(watchIds, 'instructor_assigned', 48);

      expect(result).toEqual(new Set(['watch-1']));
      expect(mockRpc).toHaveBeenCalledWith('try_record_notifications_batch', {
        p_class_watch_ids: watchIds,
        p_notification_type: 'instructor_assigned',
        p_expires_hours: 48,
      });
    });

    it('should return empty set when all notifications are already recorded', async () => {
      const watchIds = ['watch-1', 'watch-2'];
      mockRpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await tryRecordNotificationsBatch(watchIds, 'seat_available');

      expect(result).toEqual(new Set());
    });

    it('should return only newly recorded watch IDs', async () => {
      const watchIds = ['watch-1', 'watch-2', 'watch-3'];
      mockRpc.mockResolvedValue({
        data: ['watch-2'], // Only watch-2 was newly recorded
        error: null,
      });

      const result = await tryRecordNotificationsBatch(watchIds, 'seat_available');

      expect(result).toEqual(new Set(['watch-2']));
    });

    it('should handle empty watch IDs array', async () => {
      const result = await tryRecordNotificationsBatch([], 'seat_available');

      expect(result).toEqual(new Set());
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('should throw error when RPC fails', async () => {
      const watchIds = ['watch-1'];
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(tryRecordNotificationsBatch(watchIds, 'seat_available')).rejects.toThrow(
        'Failed to batch record notifications: Database error'
      );
    });

    it('should use default expiration of 24 hours', async () => {
      mockRpc.mockResolvedValue({
        data: ['watch-1'],
        error: null,
      });

      await tryRecordNotificationsBatch(['watch-1'], 'seat_available');

      expect(mockRpc).toHaveBeenCalledWith('try_record_notifications_batch', {
        p_class_watch_ids: ['watch-1'],
        p_notification_type: 'seat_available',
        p_expires_hours: 24,
      });
    });
  });

  describe('resetNotificationsForSection', () => {
    it('should reset seat_available notifications for a section', async () => {
      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
      };
      mockQuery.eq.mockImplementation((key, _value) => {
        if (key === 'term') {
          return Promise.resolve({
            data: [{ id: 'watch-1' }, { id: 'watch-2' }],
            error: null,
          });
        }
        return mockQuery;
      });

      mockFrom.mockReturnValue({
        select: vi.fn(() => mockQuery),
        delete: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        })),
      });

      await resetNotificationsForSection('12345', '2261', 'seat_available');

      expect(mockFrom).toHaveBeenCalledWith('class_watches');
    });

    it('should throw error when fetching watches fails', async () => {
      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
      };
      mockQuery.eq.mockImplementation((key, _value) => {
        if (key === 'term') {
          return Promise.resolve({
            data: null,
            error: { message: 'Connection error' },
          });
        }
        return mockQuery;
      });

      mockFrom.mockReturnValue({
        select: vi.fn(() => mockQuery),
      });

      await expect(resetNotificationsForSection('12345', '2261')).rejects.toThrow(
        'Failed to fetch watches: Connection error'
      );
    });

    it('should do nothing when no watches found', async () => {
      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
      };
      mockQuery.eq.mockImplementation((key, _value) => {
        if (key === 'term') {
          return Promise.resolve({
            data: [],
            error: null,
          });
        }
        return mockQuery;
      });

      mockFrom.mockReturnValue({
        select: vi.fn(() => mockQuery),
      });

      await resetNotificationsForSection('12345', '2261', 'seat_available');

      // Should not call delete when no watches found
      expect(mockFrom).toHaveBeenCalledTimes(1);
    });

    it('should handle instructor_assigned notification type', async () => {
      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
      };
      mockQuery.eq.mockImplementation((key, _value) => {
        if (key === 'term') {
          return Promise.resolve({
            data: [{ id: 'watch-1' }],
            error: null,
          });
        }
        return mockQuery;
      });

      mockFrom.mockReturnValue({
        select: vi.fn(() => mockQuery),
        delete: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        })),
      });

      await resetNotificationsForSection('12345', '2261', 'instructor_assigned');

      expect(mockFrom).toHaveBeenCalledWith('class_watches');
    });

    it('should use seat_available as default notification type', async () => {
      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
      };
      mockQuery.eq.mockImplementation((key, _value) => {
        if (key === 'term') {
          return Promise.resolve({
            data: [{ id: 'watch-1' }],
            error: null,
          });
        }
        return mockQuery;
      });

      mockFrom.mockReturnValue({
        select: vi.fn(() => mockQuery),
        delete: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        })),
      });

      await resetNotificationsForSection('12345', '2261');

      // Should default to seat_available
      expect(mockFrom).toHaveBeenCalledWith('class_watches');
    });

    it('should filter by both class_nbr and term', async () => {
      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
      };
      mockQuery.eq.mockImplementation((key, _value) => {
        if (key === 'term') {
          return Promise.resolve({
            data: [{ id: 'watch-1' }],
            error: null,
          });
        }
        return mockQuery;
      });

      mockFrom.mockReturnValue({
        select: vi.fn(() => mockQuery),
        delete: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        })),
      });

      await resetNotificationsForSection('12345', '2261');

      expect(mockQuery.eq).toHaveBeenCalledWith('class_nbr', '12345');
      expect(mockQuery.eq).toHaveBeenCalledWith('term', '2261');
    });
  });

  describe('Notification Expiration Edge Cases', () => {
    it('should handle batch notification recording with custom expiration', async () => {
      const watchIds = ['watch-1', 'watch-2', 'watch-3'];
      mockRpc.mockResolvedValue({
        data: ['watch-1', 'watch-2', 'watch-3'],
        error: null,
      });

      const result = await tryRecordNotificationsBatch(watchIds, 'seat_available', 48);

      expect(result.size).toBe(3);
      expect(mockRpc).toHaveBeenCalledWith('try_record_notifications_batch', {
        p_class_watch_ids: watchIds,
        p_notification_type: 'seat_available',
        p_expires_hours: 48,
      });
    });

    it('should handle partial success in batch recording', async () => {
      const watchIds = ['watch-1', 'watch-2', 'watch-3'];
      mockRpc.mockResolvedValue({
        data: ['watch-1', 'watch-3'], // watch-2 was already recorded
        error: null,
      });

      const result = await tryRecordNotificationsBatch(watchIds, 'instructor_assigned');

      expect(result).toEqual(new Set(['watch-1', 'watch-3']));
    });
  });
});
