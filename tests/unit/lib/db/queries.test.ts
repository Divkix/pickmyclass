import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import {
  capConsecutiveNotFound,
  deleteSectionAndWatches,
  getNotificationWatchers,
  getClassWatchers,
  incrementConsecutiveNotFound,
  readAutoCleanupBreakerCounts,
  readSectionCheckState,
  readSectionRemovalClassInfo,
  upsertClassState,
} from '@/lib/db/queries';
import type { ClassDetails } from '@/lib/types/class';

import { createScriptedPostgres } from './scripted-postgres';

function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ');
}

function buildDetails(overrides: Partial<ClassDetails> = {}): ClassDetails {
  return {
    subject: 'CSE',
    catalog_nbr: '110',
    title: 'Introduction to Programming',
    instructor_name: 'Christine Lee',
    seats_available: 3,
    seats_capacity: 100,
    non_reserved_seats: 2,
    location: 'BYAO 210',
    meeting_times: 'MWF 9:00-9:50am',
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getClassWatchers', () => {
  it('calls get_class_watchers with the full SectionRef and normalizes timestamps to ISO strings', async () => {
    const h = createScriptedPostgres();
    h.next([
      {
        user_id: 'u1',
        email: 'u1@example.com',
        watch_id: 'w1',
        created_at: '2026-08-25 10:00:00+00',
      },
    ]);

    const watchers = await getClassWatchers(h.db, { class_nbr: '76337', term: '2261' });

    expect(watchers).toEqual([
      {
        user_id: 'u1',
        email: 'u1@example.com',
        watch_id: 'w1',
        created_at: '2026-08-25T10:00:00.000Z',
      },
    ]);
    expect(h.statements).toHaveLength(1);
    expect(normalizeSql(h.statements[0].sql)).toContain('public.get_class_watchers');
    expect(h.statements[0].params).toEqual(['76337', '2261']);
  });

  it('passes Date instances from the driver through unchanged as ISO strings', async () => {
    const h = createScriptedPostgres();
    h.next([
      {
        user_id: 'u2',
        email: 'u2@example.com',
        watch_id: 'w2',
        created_at: new Date('2026-08-25T10:30:00Z'),
      },
    ]);

    const watchers = await getClassWatchers(h.db, { class_nbr: '76337', term: '2261' });

    expect(watchers[0]?.created_at).toBe('2026-08-25T10:30:00.000Z');
  });

  it('translates DB errors into Failed to fetch watchers', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('connection refused'));

    await expect(getClassWatchers(h.db, { class_nbr: '76337', term: '2261' })).rejects.toThrow(
      'Failed to fetch watchers: connection refused'
    );
  });
});

describe('getNotificationWatchers', () => {
  it('calls get_watchers_for_sections with a server-composed single-element array and the term, and projects recipient rows', async () => {
    const h = createScriptedPostgres();
    h.next([
      { user_id: 'user-1', email: 'user-1@example.com', watch_id: 'watch-1' },
      { user_id: 'user-2', email: 'user-2@example.com', watch_id: 'watch-2' },
    ]);

    const result = await getNotificationWatchers(h.db, { class_nbr: '42737', term: '2261' });

    expect(result).toEqual([
      { user_id: 'user-1', email: 'user-1@example.com', watch_id: 'watch-1' },
      { user_id: 'user-2', email: 'user-2@example.com', watch_id: 'watch-2' },
    ]);
    expect(h.statements).toHaveLength(1);
    expect(normalizeSql(h.statements[0].sql)).toContain('public.get_watchers_for_sections');
    expect(normalizeSql(h.statements[0].sql)).toContain('ARRAY[');
    expect(normalizeSql(h.statements[0].sql)).toContain('::text');
    expect(h.statements[0].params).toEqual(['42737', '2261']);
  });

  it('returns an empty array when no eligible watchers exist', async () => {
    const h = createScriptedPostgres();

    const result = await getNotificationWatchers(h.db, { class_nbr: '42737', term: '2261' });

    expect(result).toEqual([]);
  });

  it('translates DB errors into Failed to fetch notification watchers', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('connection refused'));

    await expect(
      getNotificationWatchers(h.db, { class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Failed to fetch notification watchers: connection refused');
  });
});

describe('incrementConsecutiveNotFound', () => {
  it('atomic RPC success: calls increment_consecutive_not_found with SectionRef and returns new count', async () => {
    const h = createScriptedPostgres();
    h.next([{ new_count: 3 }]);

    const newCount = await incrementConsecutiveNotFound(h.db, { class_nbr: '76337', term: '2261' });

    expect(newCount).toBe(3);
    expect(h.statements).toHaveLength(1);
    expect(normalizeSql(h.statements[0].sql)).toContain('public.increment_consecutive_not_found');
    expect(h.statements[0].params).toEqual(['76337', '2261']);
  });

  it('when row does not exist (Section not found) inserts placeholder row with count=1 and SectionRef', async () => {
    const h = createScriptedPostgres();
    h.failNext(pgError('P0001', 'Section not found'));

    const newCount = await incrementConsecutiveNotFound(h.db, { class_nbr: '42737', term: '2261' });

    expect(newCount).toBe(1);
    expect(h.statements).toHaveLength(2);
    expect(normalizeSql(h.statements[0].sql)).toContain('public.increment_consecutive_not_found');
    const insertSql = normalizeSql(h.statements[1].sql);
    expect(insertSql).toContain('insert into "class_states"');
    expect(insertSql).not.toContain('on conflict');
    expect(h.statements[1].params.slice(0, 2)).toEqual(['42737', '2261']);
    expect(h.statements[1].params.at(-1)).toBe(1);
  });

  it('handles a 23505 race after insert by retrying the atomic RPC against the winning row', async () => {
    const h = createScriptedPostgres();
    h.failNext(pgError('P0001', 'Section not found'));
    h.failNext(
      pgError(
        '23505',
        'duplicate key value violates unique constraint "class_states_class_nbr_term_key"'
      )
    );
    h.next([{ new_count: 2 }]);

    const newCount = await incrementConsecutiveNotFound(h.db, { class_nbr: '42737', term: '2261' });

    expect(newCount).toBe(2);
    expect(h.statements).toHaveLength(3);
    expect(normalizeSql(h.statements[0].sql)).toContain('public.increment_consecutive_not_found');
    expect(normalizeSql(h.statements[1].sql)).toContain('insert into "class_states"');
    expect(normalizeSql(h.statements[2].sql)).toContain('public.increment_consecutive_not_found');
    expect(h.statements[2].params).toEqual(['42737', '2261']);
  });

  it('detects Section not found via the raised message even when SQLSTATE is dropped by an intermediary', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('Section not found: 99999'));

    const newCount = await incrementConsecutiveNotFound(h.db, { class_nbr: '99999', term: '2261' });

    expect(newCount).toBe(1);
  });

  it('term scoping: different terms bind their own term param', async () => {
    const h = createScriptedPostgres();
    h.next([{ new_count: 1 }]);
    await incrementConsecutiveNotFound(h.db, { class_nbr: '76337', term: '2261' });

    h.next([{ new_count: 2 }]);
    await incrementConsecutiveNotFound(h.db, { class_nbr: '76337', term: '2257' });

    expect(h.statements[0].params).toEqual(['76337', '2261']);
    expect(h.statements[1].params).toEqual(['76337', '2257']);
  });

  it('throws on non-notFound RPC errors without attempting the insert fallback', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('deadlock detected'));

    await expect(
      incrementConsecutiveNotFound(h.db, { class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Failed to increment consecutive_not_found_count: deadlock detected');
    expect(h.statements).toHaveLength(1);
  });

  it('generic insert failure (42501 permission denied) throws translated, not race-recovery', async () => {
    const h = createScriptedPostgres();
    h.failNext(pgError('P0001', 'Section not found'));
    h.failNext(pgError('42501', 'permission denied for table class_states'));

    await expect(
      incrementConsecutiveNotFound(h.db, { class_nbr: '42737', term: '2261' })
    ).rejects.toThrow(
      'Failed to increment consecutive_not_found_count: permission denied for table class_states'
    );
    expect(h.statements).toHaveLength(2);
  });

  it('RPC returning null throws validation', async () => {
    const h = createScriptedPostgres();
    h.next([{ new_count: null }]);

    await expect(
      incrementConsecutiveNotFound(h.db, { class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Invalid increment result');
  });

  it('RPC returning a non-numeric scalar throws validation', async () => {
    const h = createScriptedPostgres();
    h.next([{ new_count: 'not-a-number' }]);

    await expect(
      incrementConsecutiveNotFound(h.db, { class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Invalid increment result');
  });

  it('race retry RPC returning null throws validation', async () => {
    const h = createScriptedPostgres();
    h.failNext(pgError('P0001', 'Section not found'));
    h.failNext(pgError('23505', 'duplicate key value violates unique constraint'));
    h.next([{ new_count: null }]);

    await expect(
      incrementConsecutiveNotFound(h.db, { class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Invalid increment result');
  });

  it('a generic RAISE EXCEPTION without the Section not found message never reaches the insert fallback', async () => {
    const h = createScriptedPostgres();
    h.failNext(pgError('P0001', 'some other invariant broken'));

    await expect(
      incrementConsecutiveNotFound(h.db, { class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Failed to increment consecutive_not_found_count');
    expect(h.statements).toHaveLength(1);
  });
});

describe('deleteSectionAndWatches', () => {
  it('deletes class_watches then class_states inside one transaction, SectionRef-scoped, and returns counts', async () => {
    const h = createScriptedPostgres();
    h.next([{ id: 'w1' }, { id: 'w2' }]);
    h.next([{ id: 's1' }]);

    const result = await deleteSectionAndWatches(h.db, { class_nbr: '42737', term: '2261' });

    expect(result).toEqual({ watchesDeleted: 2, stateDeleted: true });
    expect(h.transactionCount).toBe(1);
    expect(h.statements).toHaveLength(2);
    expect(normalizeSql(h.statements[0].sql)).toContain('delete from "class_watches"');
    expect(normalizeSql(h.statements[1].sql)).toContain('delete from "class_states"');
    expect(h.statements[0].params).toEqual(['42737', '2261']);
    expect(h.statements[1].params).toEqual(['42737', '2261']);
  });

  it('reports stateDeleted=false when no class_states row exists', async () => {
    const h = createScriptedPostgres();
    h.next([]);

    const result = await deleteSectionAndWatches(h.db, { class_nbr: '99999', term: '2261' });

    expect(result).toEqual({ watchesDeleted: 0, stateDeleted: false });
  });

  it('propagates mid-transaction failure as a translated abort (transaction rolled back, nothing returned)', async () => {
    const h = createScriptedPostgres();
    h.next([{ id: 'w1' }]);
    h.failNext(new Error('statement timeout'));

    await expect(
      deleteSectionAndWatches(h.db, { class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Failed to delete section: statement timeout');
    expect(h.transactionCount).toBe(1);
    expect(h.statements).toHaveLength(2);
  });
});

describe('readAutoCleanupBreakerCounts', () => {
  it('runs both COUNT probes and returns raw counts without policy math', async () => {
    const h = createScriptedPostgres();
    h.next([{ value: 40 }]);
    h.next([{ value: 7 }]);

    const counts = await readAutoCleanupBreakerCounts(h.db);

    expect(counts).toEqual({ total: 40, flagged: 7 });
    expect(h.statements).toHaveLength(2);
    expect(normalizeSql(h.statements[0].sql)).toBe('select count(*) from "class_states"');
    const flaggedSql = normalizeSql(h.statements[1].sql);
    expect(flaggedSql).toContain('count(*)');
    expect(flaggedSql).toContain('"consecutive_not_found_count" >=');
  });

  it('projects missing scalars to 0', async () => {
    const h = createScriptedPostgres();

    await expect(readAutoCleanupBreakerCounts(h.db)).resolves.toEqual({ total: 0, flagged: 0 });
  });

  it('translates errors following the DB idiom', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('connection refused'));

    await expect(readAutoCleanupBreakerCounts(h.db)).rejects.toThrow(
      'Failed to read auto-cleanup breaker counts: connection refused'
    );
  });
});

describe('capConsecutiveNotFound', () => {
  it('runs the guarded UPDATE with capped value and full SectionRef params', async () => {
    const h = createScriptedPostgres();

    await capConsecutiveNotFound(h.db, { class_nbr: '76337', term: '2261' }, 2);

    expect(h.statements).toHaveLength(1);
    const sqlText = normalizeSql(h.statements[0].sql);
    expect(sqlText).toContain('update "class_states"');
    expect(sqlText).toMatch(/"consecutive_not_found_count" (!=|<>) \$4/);
    expect(h.statements[0].params).toEqual([2, '76337', '2261', 2]);
  });

  it('translates errors following the DB idiom', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('deadlock detected'));

    await expect(
      capConsecutiveNotFound(h.db, { class_nbr: '76337', term: '2261' }, 2)
    ).rejects.toThrow('Failed to cap consecutive_not_found_count: deadlock detected');
  });
});

describe('readSectionRemovalClassInfo', () => {
  it('selects subject/catalog_nbr/title keyed by full SectionRef', async () => {
    const h = createScriptedPostgres();
    h.next([{ subject: 'CSE', catalog_nbr: '110', title: 'Introduction to Programming' }]);

    const info = await readSectionRemovalClassInfo(h.db, { class_nbr: '76337', term: '2261' });

    expect(info).toEqual({
      subject: 'CSE',
      catalog_nbr: '110',
      title: 'Introduction to Programming',
    });
    expect(h.statements).toHaveLength(1);
    const sqlText = normalizeSql(h.statements[0].sql);
    expect(sqlText).toContain('select "subject", "catalog_nbr", "title" from "class_states"');
    expect(h.statements[0].params).toEqual(['76337', '2261', 1]);
  });

  it('returns null when no class_states row exists', async () => {
    const h = createScriptedPostgres();

    await expect(
      readSectionRemovalClassInfo(h.db, { class_nbr: '42737', term: '2257' })
    ).resolves.toBeNull();
  });

  it('translates errors following the DB idiom', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('relation "class_states" does not exist'));

    await expect(
      readSectionRemovalClassInfo(h.db, { class_nbr: '42737', term: '2257' })
    ).rejects.toThrow('Failed to fetch removal class info: relation "class_states" does not exist');
  });
});

describe('readSectionCheckState', () => {
  it('returns the persisted old-state row for a known section', async () => {
    const h = createScriptedPostgres();
    h.next([
      {
        class_nbr: '76337',
        term: '2261',
        seats_available: 3,
        non_reserved_seats: 2,
        instructor_name: 'Christine Lee',
        consecutive_not_found_count: 0,
      },
    ]);

    const state = await readSectionCheckState(h.db, { class_nbr: '76337', term: '2261' });

    expect(state).toEqual({
      class_nbr: '76337',
      term: '2261',
      seats_available: 3,
      non_reserved_seats: 2,
      instructor_name: 'Christine Lee',
      consecutive_not_found_count: 0,
    });
    expect(h.statements).toHaveLength(1);
    expect(h.statements[0].params).toEqual(['76337', '2261', 1]);
  });

  it('returns null when no class_states row exists (first observation)', async () => {
    const h = createScriptedPostgres();

    await expect(
      readSectionCheckState(h.db, { class_nbr: '42737', term: '2257' })
    ).resolves.toBeNull();
  });

  it('projects exactly the change-detection columns keyed by the full SectionRef', async () => {
    const h = createScriptedPostgres();

    await readSectionCheckState(h.db, { class_nbr: '76337', term: '2261' });

    expect(h.statements).toHaveLength(1);
    const sqlText = normalizeSql(h.statements[0].sql);
    expect(sqlText).toContain(
      'select "class_nbr", "term", "seats_available", "non_reserved_seats", "instructor_name", "consecutive_not_found_count" from "class_states"'
    );
    expect(h.statements[0].params).toEqual(['76337', '2261', 1]);
  });

  it('translates errors following the DB idiom', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('relation "class_states" does not exist'));

    await expect(readSectionCheckState(h.db, { class_nbr: '42737', term: '2257' })).rejects.toThrow(
      'Failed to fetch section check state: relation "class_states" does not exist'
    );
  });
});

describe('upsertClassState', () => {
  it('upserts ASU details keyed by (class_nbr, term) without touching last_changed_at', async () => {
    const h = createScriptedPostgres();

    await upsertClassState(h.db, { class_nbr: '12345', term: '2261' }, buildDetails());

    expect(h.statements).toHaveLength(1);
    const sqlText = normalizeSql(h.statements[0].sql);
    expect(sqlText).toContain('insert into "class_states"');
    expect(sqlText).toContain('on conflict ("class_nbr","term") do update set');
    const setClause = sqlText.slice(sqlText.indexOf('do update set'));
    expect(setClause).not.toContain('last_changed_at');
    expect(sqlText).toContain('"consecutive_not_found_count"');
    const params = h.statements[0].params;
    expect(params.slice(0, 5)).toEqual([
      '12345',
      '2261',
      'CSE',
      '110',
      'Introduction to Programming',
    ]);
  });

  it('preserves the legacy falsy coercions: empty strings become null, zero stays zero', async () => {
    const h = createScriptedPostgres();

    await upsertClassState(
      h.db,
      { class_nbr: '12345', term: '2261' },
      buildDetails({
        instructor_name: '',
        non_reserved_seats: 0,
        location: '',
        meeting_times: '',
        seats_available: 0,
        seats_capacity: 0,
      })
    );

    const params = h.statements[0].params;
    expect(params[5]).toBeNull();
    expect(params[6]).toBe(0);
    expect(params[7]).toBe(0);
    expect(params[8]).toBe(0);
    expect(params[9]).toBeNull();
    expect(params[10]).toBeNull();
  });

  it('resets consecutive_not_found_count to 0 on both insert and conflict paths', async () => {
    const h = createScriptedPostgres();

    await upsertClassState(h.db, { class_nbr: '12345', term: '2261' }, buildDetails());

    const sqlText = normalizeSql(h.statements[0].sql);
    expect(sqlText.match(/consecutive_not_found_count/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('translates failures following the module idiom', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('connection refused'));

    await expect(
      upsertClassState(h.db, { class_nbr: '12345', term: '2261' }, buildDetails())
    ).rejects.toThrow('Failed to upsert class state: connection refused');
  });
});
