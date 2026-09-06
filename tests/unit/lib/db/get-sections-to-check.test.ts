import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { getSectionsToCheck } from '@/lib/db/queries';

import { expectRpcFailure } from './rpc-failure';
import { createScriptedPostgres } from './scripted-postgres';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getSectionsToCheck', () => {
  it('calls get_sections_to_check with the stagger_type parameter and maps SectionRefs', async () => {
    const h = createScriptedPostgres();
    h.next([
      { class_nbr: '12345', term: '2261' },
      { class_nbr: '12346', term: '2261' },
    ]);

    const result = await getSectionsToCheck(h.db, 'even');

    expect(result).toEqual([
      { class_nbr: '12345', term: '2261' },
      { class_nbr: '12346', term: '2261' },
    ]);
    expect(h.statements).toHaveLength(1);
    expect(h.statements[0].sql).toContain('public.get_sections_to_check');
    expect(h.statements[0].params).toEqual(['even']);
  });

  it('defaults to the "all" stagger group when called without an argument', async () => {
    const h = createScriptedPostgres();

    await getSectionsToCheck(h.db);

    expect(h.statements[0].params).toEqual(['all']);
  });

  it('returns an empty array for an empty RPC result', async () => {
    const h = createScriptedPostgres();

    const result = await getSectionsToCheck(h.db, 'even');

    expect(result).toEqual([]);
  });

  it('throws when the RPC fails', async () => {
    const h = createScriptedPostgres();
    h.failNext(new Error('Database connection failed'));

    await expectRpcFailure(
      getSectionsToCheck(h.db, 'odd'),
      'Failed to fetch sections',
      'Database connection failed'
    );
  });
});
