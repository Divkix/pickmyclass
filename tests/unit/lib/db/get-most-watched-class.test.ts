import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { getMostWatchedClass } from '@/lib/db/queries';

import { createScriptedPostgres } from './scripted-postgres';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getMostWatchedClass', () => {
  it('calls get_most_watched_class with the supplied term and returns the top SectionRef', async () => {
    const h = createScriptedPostgres();
    h.next([{ class_nbr: '12345', term: '2267' }]);

    const result = await getMostWatchedClass(h.db, '2267');

    expect(result).toEqual({ class_nbr: '12345', term: '2267' });
    expect(h.statements).toHaveLength(1);
    expect(h.statements[0].sql).toContain('public.get_most_watched_class');
    expect(h.statements[0].params).toEqual(['2267']);
  });

  it('returns null when no active watches exist for the term', async () => {
    const h = createScriptedPostgres();

    const result = await getMostWatchedClass(h.db, '2267');

    expect(result).toBeNull();
  });

  it('reads only the first row (the RPC orders by watcher count and limits to 1)', async () => {
    const h = createScriptedPostgres();
    h.next([
      { class_nbr: '99999', term: '2267' },
      { class_nbr: '11111', term: '2267' },
    ]);

    const result = await getMostWatchedClass(h.db, '2267');

    expect(result).toEqual({ class_nbr: '99999', term: '2267' });
  });

  it('throws when the RPC fails', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('boom'));

    await expect(getMostWatchedClass(h.db, '2267')).rejects.toThrow(
      'Failed to fetch most watched class: boom'
    );
  });
});
