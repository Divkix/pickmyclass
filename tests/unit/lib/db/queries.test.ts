import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

import {
  deleteSectionAndWatches,
  incrementConsecutiveNotFound,
  resetConsecutiveNotFound,
} from '@/lib/db/queries';
import { getServiceClient } from '@/lib/supabase/service';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.clearAllMocks();
});

// helper to build a select→eq→eq→single chain
function mockSelectSingle(result: {
  data: Record<string, unknown> | null;
  error: { code?: string; message: string } | null;
}) {
  const single = vi.fn().mockResolvedValue(result);
  const secondEq = vi.fn().mockReturnValue({ single });
  const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
  const select = vi.fn().mockReturnValue({ eq: firstEq });
  return { select, firstEq, secondEq, single };
}

// helper to build update→eq→eq chain that resolves to {error:null}
function mockUpdateChain() {
  const secondEq = vi.fn().mockResolvedValue({ error: null });
  const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
  const update = vi.fn().mockReturnValue({ eq: firstEq });
  return { update, firstEq, secondEq };
}

// helper to build delete→eq→eq chain that resolves to {count, error}
function mockDeleteChain(count: number) {
  const secondEq = vi.fn().mockResolvedValue({ count, error: null });
  const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
  const del = vi.fn().mockReturnValue({ eq: firstEq });
  return { del, firstEq, secondEq };
}

describe('incrementConsecutiveNotFound', () => {
  it('is SectionRef-scoped (both class_nbr and term) and returns new count', async () => {
    const { select, firstEq, secondEq } = mockSelectSingle({
      data: { consecutive_not_found_count: 2 },
      error: null,
    });
    const { update, firstEq: updFirst, secondEq: updSecond } = mockUpdateChain();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'class_states') {
        // SAFETY: test mock — Supabase client stub with typed query builder
        const stub = { select, update } as unknown;
        // SAFETY: test mock — Supabase client stub with typed query builder
        return stub as ReturnType<typeof getServiceClient> extends {
          from: infer F;
        }
          ? F
          : never;
      }
      // SAFETY: test mock — Supabase client stub with typed query builder
      const fallback = { select, update } as unknown;
      // SAFETY: test mock — Supabase client stub with typed query builder
      return fallback as never;
    });

    const newCount = await incrementConsecutiveNotFound({ class_nbr: '76337', term: '2261' });

    expect(newCount).toBe(3);
    // verify select was scoped
    expect(select).toHaveBeenCalledWith('consecutive_not_found_count');
    expect(firstEq).toHaveBeenCalledWith('class_nbr', '76337');
    expect(secondEq).toHaveBeenCalledWith('term', '2261');
    // verify update was scoped with new count 3
    expect(update).toHaveBeenCalledWith({ consecutive_not_found_count: 3 });
    expect(updFirst).toHaveBeenCalledWith('class_nbr', '76337');
    expect(updSecond).toHaveBeenCalledWith('term', '2261');
  });

  it('when row does not exist (PGRST116) creates via insert with count=1 and SectionRef', async () => {
    const { select, firstEq, secondEq } = mockSelectSingle({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation(() => {
      // SAFETY: test mock — Supabase client stub with typed query builder
      const stub = { select, insert } as unknown;
      // SAFETY: test mock — Supabase client stub with typed query builder
      return stub as never;
    });

    const newCount = await incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' });

    expect(newCount).toBe(1);
    expect(firstEq).toHaveBeenCalledWith('class_nbr', '42737');
    expect(secondEq).toHaveBeenCalledWith('term', '2261');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        class_nbr: '42737',
        term: '2261',
        consecutive_not_found_count: 1,
      })
    );
  });

  it('term scoping: different terms are independent (verify mock expects term param)', async () => {
    const { select, firstEq, secondEq } = mockSelectSingle({
      data: { consecutive_not_found_count: 5 },
      error: null,
    });
    const { update } = mockUpdateChain();
    // SAFETY: test mock — Supabase client stub with typed query builder
    const stub1 = { select, update } as unknown;
    // SAFETY: test mock — Supabase client stub with typed query builder
    mockFrom.mockReturnValue(stub1 as never);

    await incrementConsecutiveNotFound({ class_nbr: '76337', term: '2261' });
    expect(firstEq).toHaveBeenCalledWith('class_nbr', '76337');
    expect(secondEq).toHaveBeenCalledWith('term', '2261');

    vi.clearAllMocks();
    const {
      select: sel2,
      firstEq: fe2,
      secondEq: se2,
    } = mockSelectSingle({
      data: { consecutive_not_found_count: 1 },
      error: null,
    });
    const { update: upd2 } = mockUpdateChain();
    // SAFETY: test mock — Supabase client stub with typed query builder
    const stub2 = { select: sel2, update: upd2 } as unknown;
    // SAFETY: test mock — Supabase client stub with typed query builder
    mockFrom.mockReturnValue(stub2 as never);
    await incrementConsecutiveNotFound({ class_nbr: '76337', term: '2257' });
    expect(fe2).toHaveBeenCalledWith('class_nbr', '76337');
    expect(se2).toHaveBeenCalledWith('term', '2257');
    // ensure second term call did NOT reuse previous term 2261
    expect(se2).not.toHaveBeenCalledWith('term', '2261');
    expect(fe2).toHaveBeenCalledTimes(1);
    expect(sel2).toHaveBeenCalled();
  });
});

describe('resetConsecutiveNotFound', () => {
  it('sets consecutive_not_found_count to 0, SectionRef-scoped', async () => {
    const { update, firstEq, secondEq } = mockUpdateChain();
    // SAFETY: test mock — Supabase client stub with typed query builder
    const stub = { update } as unknown;
    // SAFETY: test mock — Supabase client stub with typed query builder
    mockFrom.mockReturnValue(stub as never);

    await resetConsecutiveNotFound({ class_nbr: '42737', term: '2261' });

    expect(update).toHaveBeenCalledWith({ consecutive_not_found_count: 0 });
    expect(firstEq).toHaveBeenCalledWith('class_nbr', '42737');
    expect(secondEq).toHaveBeenCalledWith('term', '2261');
  });
});

describe('deleteSectionAndWatches', () => {
  it('deletes class_watches then class_states, both SectionRef-scoped, and returns counts', async () => {
    const { del: delWatches, firstEq: feW, secondEq: seW } = mockDeleteChain(2);
    const { del: delState, firstEq: feS, secondEq: seS } = mockDeleteChain(1);

    mockFrom.mockImplementation((table: string) => {
      if (table === 'class_watches') {
        // SAFETY: test mock — Supabase client stub with typed query builder
        const stub = { delete: delWatches } as unknown;
        // SAFETY: test mock — Supabase client stub with typed query builder
        return stub as never;
      }
      if (table === 'class_states') {
        // SAFETY: test mock — Supabase client stub with typed query builder
        const stub = { delete: delState } as unknown;
        // SAFETY: test mock — Supabase client stub with typed query builder
        return stub as never;
      }
      // SAFETY: test mock — Supabase client stub with typed query builder
      const fallback = { delete: delWatches } as unknown;
      // SAFETY: test mock — Supabase client stub with typed query builder
      return fallback as never;
    });

    const result = await deleteSectionAndWatches({ class_nbr: '42737', term: '2261' });

    expect(delWatches).toHaveBeenCalledWith({ count: 'exact' });
    expect(feW).toHaveBeenCalledWith('class_nbr', '42737');
    expect(seW).toHaveBeenCalledWith('term', '2261');

    expect(delState).toHaveBeenCalledWith({ count: 'exact' });
    expect(feS).toHaveBeenCalledWith('class_nbr', '42737');
    expect(seS).toHaveBeenCalledWith('term', '2261');

    expect(result).toEqual({ watchesDeleted: 2, stateDeleted: true });
    // verify order: watches deleted before state (mockFrom call order)
    expect(mockFrom.mock.calls[0][0]).toBe('class_watches');
    expect(mockFrom.mock.calls[1][0]).toBe('class_states');
  });

  it('SectionRef-scoped WHERE verified (both fields) for delete', async () => {
    const { del: delW, firstEq: feW, secondEq: seW } = mockDeleteChain(0);
    const { del: delS, firstEq: feS, secondEq: seS } = mockDeleteChain(0);
    mockFrom.mockImplementation((table: string) => {
      if (table === 'class_watches') {
        // SAFETY: test mock — Supabase client stub with typed query builder
        const stub = { delete: delW } as unknown;
        // SAFETY: test mock — Supabase client stub with typed query builder
        return stub as never;
      }
      // SAFETY: test mock — Supabase client stub with typed query builder
      const fallback = { delete: delS } as unknown;
      // SAFETY: test mock — Supabase client stub with typed query builder
      return fallback as never;
    });

    await deleteSectionAndWatches({ class_nbr: '99999', term: '2261' });

    expect(feW).toHaveBeenCalledWith('class_nbr', '99999');
    expect(seW).toHaveBeenCalledWith('term', '2261');
    expect(feS).toHaveBeenCalledWith('class_nbr', '99999');
    expect(seS).toHaveBeenCalledWith('term', '2261');
  });
});
