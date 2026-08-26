import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { tryRecordNotificationsBatch } from '@/lib/db/queries';

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
    it('composes the batch server-side as an ARRAY of scalar binds and returns claimed ids', async () => {
      const h = createScriptedPostgres();
      h.next([{ recorded: ['watch-1', 'watch-2'] }]);

      const result = await tryRecordNotificationsBatch(
        h.db,
        ['watch-1', 'watch-2'],
        'seat_available'
      );

      expect(result).toEqual(new Set(['watch-1', 'watch-2']));
      expect(h.statements).toHaveLength(1);
      expect(h.statements[0].sql).toContain('public.try_record_notifications_batch');
      expect(h.statements[0].sql).toContain('ARRAY[');
      expect(h.statements[0].params).toEqual(['watch-1', 'watch-2', 'seat_available', 24]);
    });

    it('handles instructor_assigned with a custom expiry window', async () => {
      const h = createScriptedPostgres();
      h.next([{ recorded: ['watch-1'] }]);

      const result = await tryRecordNotificationsBatch(
        h.db,
        ['watch-1'],
        'instructor_assigned',
        48
      );

      expect(result).toEqual(new Set(['watch-1']));
      expect(h.statements[0].params).toEqual(['watch-1', 'instructor_assigned', 48]);
    });

    it('parses the raw {…} wire text when the driver returns the uuid[] column unparsed', async () => {
      const h = createScriptedPostgres();
      h.next([{ recorded: '{watch-1,watch-2}' }]);

      const result = await tryRecordNotificationsBatch(
        h.db,
        ['watch-1', 'watch-2'],
        'seat_available'
      );

      expect(result).toEqual(new Set(['watch-1', 'watch-2']));
    });

    it('returns an empty set when every slot was already claimed', async () => {
      const h = createScriptedPostgres();
      h.next([{ recorded: [] }]);

      const result = await tryRecordNotificationsBatch(
        h.db,
        ['watch-1', 'watch-2'],
        'seat_available'
      );

      expect(result).toEqual(new Set());
    });

    it('returns only the newly claimed watch ids — that set is the authorization to email', async () => {
      const h = createScriptedPostgres();
      h.next([{ recorded: ['watch-2'] }]);

      const result = await tryRecordNotificationsBatch(
        h.db,
        ['watch-1', 'watch-2', 'watch-3'],
        'seat_available'
      );

      expect(result).toEqual(new Set(['watch-2']));
    });

    it('handles empty watch id arrays without issuing a query', async () => {
      const h = createScriptedPostgres();

      const result = await tryRecordNotificationsBatch(h.db, [], 'seat_available');

      expect(result).toEqual(new Set());
      expect(h.statements).toHaveLength(0);
    });

    it('treats a non-array scalar column as no claims (defensive against driver shape drift)', async () => {
      const h = createScriptedPostgres();
      h.next([{ recorded: null }]);

      const result = await tryRecordNotificationsBatch(h.db, ['watch-1'], 'seat_available');

      expect(result).toEqual(new Set());
    });

    it('throws the translated error when the RPC fails', async () => {
      const h = createScriptedPostgres();
      h.failNext(new Error('Database error'));

      await expect(
        tryRecordNotificationsBatch(h.db, ['watch-1'], 'seat_available')
      ).rejects.toThrow('Failed to batch record notifications: Database error');
    });

    it('uses the default expiration of 24 hours', async () => {
      const h = createScriptedPostgres();
      h.next([{ recorded: ['watch-1'] }]);

      await tryRecordNotificationsBatch(h.db, ['watch-1'], 'seat_available');

      expect(h.statements[0].params).toEqual(['watch-1', 'seat_available', 24]);
    });
  });

  describe('Notification Expiration Edge Cases', () => {
    it('claims the full batch with custom expiration', async () => {
      const h = createScriptedPostgres();
      h.next([{ recorded: ['watch-1', 'watch-2', 'watch-3'] }]);

      const result = await tryRecordNotificationsBatch(
        h.db,
        ['watch-1', 'watch-2', 'watch-3'],
        'seat_available',
        48
      );

      expect(result.size).toBe(3);
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
      h.next([{ recorded: ['watch-1', 'watch-3'] }]);

      const result = await tryRecordNotificationsBatch(
        h.db,
        ['watch-1', 'watch-2', 'watch-3'],
        'instructor_assigned'
      );

      expect(result).toEqual(new Set(['watch-1', 'watch-3']));
    });
  });
});
