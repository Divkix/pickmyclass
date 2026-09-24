import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { tryRecordNotificationsBatch } from '@/lib/db/queries';

import { expectRpcFailure } from './rpc-failure';
import { createScriptedPostgres } from './scripted-postgres';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Notification Expiration (Issue #157)', () => {
  describe('tryRecordNotificationsBatch', () => {
    it('composes the batch server-side as an ARRAY of scalar binds and returns claim rows', async () => {
      const h = createScriptedPostgres();
      h.next([
        { notification_id: 'row-1', class_watch_id: 'watch-1' },
        { notification_id: 'row-2', class_watch_id: 'watch-2' },
      ]);

      const result = await tryRecordNotificationsBatch(
        h.db,
        ['watch-1', 'watch-2'],
        'seat_available'
      );

      expect(result).toEqual([
        { notificationId: 'row-1', watchId: 'watch-1' },
        { notificationId: 'row-2', watchId: 'watch-2' },
      ]);
      expect(h.statements).toHaveLength(1);
      expect(h.statements[0].sql).toContain('public.try_record_notifications_batch');
      expect(h.statements[0].sql).toContain('ARRAY[');
      expect(h.statements[0].params).toEqual(['watch-1', 'watch-2', 'seat_available', 24]);
    });

    it('handles instructor_assigned with a custom expiry window', async () => {
      const h = createScriptedPostgres();
      h.next([{ notification_id: 'row-1', class_watch_id: 'watch-1' }]);

      const result = await tryRecordNotificationsBatch(
        h.db,
        ['watch-1'],
        'instructor_assigned',
        48
      );

      expect(result).toEqual([{ notificationId: 'row-1', watchId: 'watch-1' }]);
      expect(h.statements[0].params).toEqual(['watch-1', 'instructor_assigned', 48]);
    });

    it('returns an empty list when every slot was already claimed', async () => {
      const h = createScriptedPostgres();
      h.next([]);

      const result = await tryRecordNotificationsBatch(
        h.db,
        ['watch-1', 'watch-2'],
        'seat_available'
      );

      expect(result).toEqual([]);
    });

    it('returns only the newly claimed rows — that set is the authorization to email', async () => {
      const h = createScriptedPostgres();
      h.next([{ notification_id: 'row-2', class_watch_id: 'watch-2' }]);

      const result = await tryRecordNotificationsBatch(
        h.db,
        ['watch-1', 'watch-2', 'watch-3'],
        'seat_available'
      );

      expect(result).toEqual([{ notificationId: 'row-2', watchId: 'watch-2' }]);
    });

    it('handles empty watch id arrays without issuing a query', async () => {
      const h = createScriptedPostgres();

      const result = await tryRecordNotificationsBatch(h.db, [], 'seat_available');

      expect(result).toEqual([]);
      expect(h.statements).toHaveLength(0);
    });

    it('drops a row that is missing its notification id', async () => {
      const h = createScriptedPostgres();
      h.next([{ notification_id: null, class_watch_id: 'watch-1' }]);

      const result = await tryRecordNotificationsBatch(h.db, ['watch-1'], 'seat_available');

      expect(result).toEqual([]);
    });

    it('throws the translated error when the RPC fails', async () => {
      const h = createScriptedPostgres();
      h.failNext(new Error('Database error'));

      await expectRpcFailure(
        tryRecordNotificationsBatch(h.db, ['watch-1'], 'seat_available'),
        'Failed to batch record notifications',
        'Database error'
      );
    });

    it('uses the default expiration of 24 hours', async () => {
      const h = createScriptedPostgres();
      h.next([{ notification_id: 'row-1', class_watch_id: 'watch-1' }]);

      await tryRecordNotificationsBatch(h.db, ['watch-1'], 'seat_available');

      expect(h.statements[0].params).toEqual(['watch-1', 'seat_available', 24]);
    });
  });

  describe('Notification Expiration Edge Cases', () => {
    it('claims the full batch with custom expiration', async () => {
      const h = createScriptedPostgres();
      h.next([
        { notification_id: 'row-1', class_watch_id: 'watch-1' },
        { notification_id: 'row-2', class_watch_id: 'watch-2' },
        { notification_id: 'row-3', class_watch_id: 'watch-3' },
      ]);

      const result = await tryRecordNotificationsBatch(
        h.db,
        ['watch-1', 'watch-2', 'watch-3'],
        'seat_available',
        48
      );

      expect(result).toHaveLength(3);
      expect(h.statements[0].params).toEqual([
        'watch-1',
        'watch-2',
        'watch-3',
        'seat_available',
        48,
      ]);
    });

    it('supports partial success in batch recording', async () => {
      const h = createScriptedPostgres();
      h.next([
        { notification_id: 'row-1', class_watch_id: 'watch-1' },
        { notification_id: 'row-3', class_watch_id: 'watch-3' },
      ]);

      const result = await tryRecordNotificationsBatch(
        h.db,
        ['watch-1', 'watch-2', 'watch-3'],
        'instructor_assigned'
      );

      expect(result.map((claim) => claim.watchId)).toEqual(['watch-1', 'watch-3']);
    });
  });
});
