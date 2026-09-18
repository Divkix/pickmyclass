import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import {
  deleteNotificationRecords,
  deleteNotificationRecordsByIds,
  deletePastTermWatches,
  getNotificationRecordIds,
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
  it('resets a section in one join-scoped RPC call carrying class_nbr, term, and type', async () => {
    const h = createScriptedPostgres();
    h.next([{ deleted: 2 }]);

    await expect(
      resetNotificationsForSection(h.db, { class_nbr: '12345', term: '2261' }, 'seat_available')
    ).resolves.toBeUndefined();

    expect(h.statements).toHaveLength(1);
    expect(h.statements[0].sql).toContain('public.reset_section_notifications');
    expect(h.statements[0].params).toEqual(['12345', '2261', 'seat_available']);
  });

  it('defaults to seat_available when no type is passed', async () => {
    const h = createScriptedPostgres();
    h.next([{ deleted: 1 }]);

    await resetNotificationsForSection(h.db, { class_nbr: '12345', term: '2261' });

    expect(h.statements[0].params).toEqual(['12345', '2261', 'seat_available']);
  });

  it('handles instructor_assigned reset', async () => {
    const h = createScriptedPostgres();
    h.next([{ deleted: 1 }]);

    await resetNotificationsForSection(
      h.db,
      { class_nbr: '12345', term: '2261' },
      'instructor_assigned'
    );

    expect(h.statements[0].params).toEqual(['12345', '2261', 'instructor_assigned']);
  });

  it('keeps the term in the scope so a same-numbered section in another term is untouched', async () => {
    const h = createScriptedPostgres();
    h.next([{ deleted: 0 }]);

    await resetNotificationsForSection(h.db, { class_nbr: '12345', term: '2267' });

    expect(h.statements[0].params.slice(0, 2)).toEqual(['12345', '2267']);
  });

  it('rpc error → throws "Failed to reset notifications"', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('Connection error'));

    await expect(
      resetNotificationsForSection(h.db, { class_nbr: '12345', term: '2261' })
    ).rejects.toThrow('Failed to reset notifications: Connection error');
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

describe('deleteNotificationRecordsByIds', () => {
  it('empty ids → returns 0 without issuing a query', async () => {
    const h = createScriptedPostgres();

    const result = await deleteNotificationRecordsByIds(h.db, []);

    expect(result).toBe(0);
    expect(h.statements).toHaveLength(0);
  });

  it('rolls back by notification row id, never by watch id and type', async () => {
    const h = createScriptedPostgres();
    h.next([{ deleted: 1 }]);

    const result = await deleteNotificationRecordsByIds(h.db, ['row-1', 'row-2']);

    expect(result).toBe(1);
    expect(h.statements).toHaveLength(1);
    expect(h.statements[0].sql).toContain('public.delete_notification_records_by_ids');
    expect(h.statements[0].sql).toContain('ARRAY[');
    expect(h.statements[0].params).toEqual(['row-1', 'row-2']);
  });

  it('projects a null scalar count to 0', async () => {
    const h = createScriptedPostgres();
    h.next([{ deleted: null }]);

    await expect(deleteNotificationRecordsByIds(h.db, ['row-1'])).resolves.toBe(0);
  });

  it('rpc error → throws "Failed to delete notification records by id"', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('rpc failed'));

    await expect(deleteNotificationRecordsByIds(h.db, ['row-1'])).rejects.toThrow(
      'Failed to delete notification records by id: rpc failed'
    );
  });
});

describe('getNotificationRecordIds', () => {
  it('empty watchIds → empty map without issuing a query', async () => {
    const h = createScriptedPostgres();

    const result = await getNotificationRecordIds(h.db, [], 'seat_available');

    expect(result.size).toBe(0);
    expect(h.statements).toHaveLength(0);
  });

  it('maps active claim rows from watch id to row id for exactly the given type', async () => {
    const h = createScriptedPostgres();
    h.next([
      { id: 'row-1', class_watch_id: 'watch-1' },
      { id: 'row-2', class_watch_id: 'watch-2' },
    ]);

    const result = await getNotificationRecordIds(h.db, ['watch-1', 'watch-2'], 'seat_available');

    expect([...result]).toEqual([
      ['watch-1', 'row-1'],
      ['watch-2', 'row-2'],
    ]);
    expect(h.statements).toHaveLength(1);
    expect(h.statements[0].sql).toContain('"notifications_sent"."class_watch_id" in ($1, $2)');
    expect(h.statements[0].sql).toContain('"notifications_sent"."notification_type" = $3');
    expect(h.statements[0].params).toEqual(['watch-1', 'watch-2', 'seat_available', true]);
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
