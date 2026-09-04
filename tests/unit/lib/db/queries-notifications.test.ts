import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import {
  deleteNotificationRecords,
  deletePastTermWatches,
  resetNotificationsForSection,
} from '@/lib/db/queries';

import { createScriptedPostgres } from './scripted-postgres';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resetNotificationsForSection', () => {
  it('no watches found → early return, no delete issued', async () => {
    const h = createScriptedPostgres();

    await expect(
      resetNotificationsForSection(h.db, { class_nbr: '12345', term: '2261' }, 'seat_available')
    ).resolves.toBeUndefined();

    expect(h.statements).toHaveLength(1);
    expect(h.statements[0].sql).toContain('"class_watches"');
    expect(h.statements[0].params).toEqual(['12345', '2261']);
  });

  it('deletes notifications for exactly the section watches and the requested type', async () => {
    const h = createScriptedPostgres();
    h.next([{ id: 'watch-1' }, { id: 'watch-2' }]);
    h.next([{ id: 'n1' }, { id: 'n2' }]);

    await resetNotificationsForSection(
      h.db,
      { class_nbr: '12345', term: '2261' },
      'seat_available'
    );

    expect(h.statements).toHaveLength(2);
    expect(h.statements[1].sql).toContain('delete from "notifications_sent"');
    expect(h.statements[1].params).toEqual(['watch-1', 'watch-2', 'seat_available']);
  });

  it('defaults to seat_available when no type is passed', async () => {
    const h = createScriptedPostgres();
    h.next([{ id: 'watch-1' }]);
    h.next([{ id: 'n1' }]);

    await resetNotificationsForSection(h.db, { class_nbr: '12345', term: '2261' });

    expect(h.statements[1].params).toEqual(['watch-1', 'seat_available']);
  });

  it('handles instructor_assigned reset', async () => {
    const h = createScriptedPostgres();
    h.next([{ id: 'watch-1' }]);
    h.next([{ id: 'n1' }]);

    await resetNotificationsForSection(
      h.db,
      { class_nbr: '12345', term: '2261' },
      'instructor_assigned'
    );

    expect(h.statements[1].params).toEqual(['watch-1', 'instructor_assigned']);
  });

  it('filters watch lookup by both class_nbr and term', async () => {
    const h = createScriptedPostgres();

    await resetNotificationsForSection(h.db, { class_nbr: '12345', term: '2261' });

    expect(h.statements[0].params).toEqual(['12345', '2261']);
  });

  it('watch-fetch error → throws "Failed to reset notifications"', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('Connection error'));

    await expect(
      resetNotificationsForSection(h.db, { class_nbr: '12345', term: '2261' })
    ).rejects.toThrow('Failed to reset notifications: Connection error');
  });

  it('delete error → throws "Failed to reset notifications"', async () => {
    const h = createScriptedPostgres();
    h.next([{ id: 'watch-1' }, { id: 'watch-2' }]);
    h.failNext(new Error('delete blew up'));

    await expect(
      resetNotificationsForSection(h.db, { class_nbr: '12345', term: '2261' }, 'seat_available')
    ).rejects.toThrow('Failed to reset notifications: delete blew up');
  });
});

describe('deleteNotificationRecords', () => {
  it('empty watchIds → returns 0 without issuing a query', async () => {
    const h = createScriptedPostgres();

    const result = await deleteNotificationRecords(h.db, [], 'seat_available');

    expect(result).toBe(0);
    expect(h.statements).toHaveLength(0);
  });

  it('composes the watch ids server-side as an ARRAY of scalar binds and returns the deleted count', async () => {
    const h = createScriptedPostgres();
    h.next([{ deleted: 3 }]);

    const result = await deleteNotificationRecords(h.db, ['w-1', 'w-2', 'w-3'], 'seat_available');

    expect(result).toBe(3);
    expect(h.statements).toHaveLength(1);
    expect(h.statements[0].sql).toContain('public.delete_notification_records');
    expect(h.statements[0].sql).toContain('ARRAY[');
    expect(h.statements[0].params).toEqual(['w-1', 'w-2', 'w-3', 'seat_available']);
  });

  it('projects a null scalar count to 0', async () => {
    const h = createScriptedPostgres();
    h.next([{ deleted: null }]);

    const result = await deleteNotificationRecords(h.db, ['w-1'], 'seat_available');

    expect(result).toBe(0);
  });

  it('rpc error → throws "Failed to delete notification records"', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('rpc failed'));

    await expect(
      deleteNotificationRecords(h.db, ['watch-1', 'watch-2'], 'seat_available')
    ).rejects.toThrow('Failed to delete notification records: rpc failed');
    expect(h.statements[0].params).toEqual(['watch-1', 'watch-2', 'seat_available']);
  });
});

describe('deletePastTermWatches', () => {
  it('empty termCodes → returns 0 without issuing a query', async () => {
    const h = createScriptedPostgres();

    const result = await deletePastTermWatches(h.db, []);

    expect(result).toBe(0);
    expect(h.statements).toHaveLength(0);
  });

  it('hard-deletes all watches for the given terms and returns the deleted row count', async () => {
    const h = createScriptedPostgres();
    h.next([{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }]);

    const result = await deletePastTermWatches(h.db, ['2247', '2257']);

    expect(result).toBe(3);
    expect(h.statements).toHaveLength(1);
    const sqlText = h.statements[0].sql;
    expect(sqlText).toContain('delete from "class_watches"');
    expect(sqlText).toContain('returning "id"');
    expect(sqlText).toContain('"class_watches"."term" in ($1, $2)');
    expect(h.statements[0].params).toEqual(['2247', '2257']);
  });

  it('translates errors following the DB idiom', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('deadlock detected'));

    await expect(deletePastTermWatches(h.db, ['2257'])).rejects.toThrow(
      'Failed to delete past-term watches: deadlock detected'
    );
  });
});
