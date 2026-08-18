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
// getServiceClient mocked via vi.mock — no direct import needed

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.clearAllMocks();
});

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
  it('atomic RPC success: calls increment_consecutive_not_found with SectionRef and returns new count', async () => {
    mockRpc.mockResolvedValue({ data: 3, error: null });

    const newCount = await incrementConsecutiveNotFound({ class_nbr: '76337', term: '2261' });

    expect(newCount).toBe(3);
    expect(mockRpc).toHaveBeenCalledWith('increment_consecutive_not_found', {
      p_class_nbr: '76337',
      p_term: '2261',
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('when row does not exist (Section not found) creates via insert with count=1 and SectionRef', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Section not found', code: 'P0001' },
    });
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation(() => {
      // SAFETY: test mock — Supabase client stub with typed query builder
      const stub = { insert } as unknown;
      // SAFETY: test mock — Supabase client stub with typed query builder
      return stub as never;
    });

    const newCount = await incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' });

    expect(newCount).toBe(1);
    expect(mockRpc).toHaveBeenCalledWith('increment_consecutive_not_found', {
      p_class_nbr: '42737',
      p_term: '2261',
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        class_nbr: '42737',
        term: '2261',
        consecutive_not_found_count: 1,
      })
    );
  });

  it('handles 23505 race after insert by retrying atomic RPC', async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'Section not found', code: 'P0001' },
      })
      .mockResolvedValueOnce({ data: 2, error: null });
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    mockFrom.mockImplementation(() => {
      // SAFETY: test mock — Supabase client stub with typed query builder
      const stub = { insert } as unknown;
      // SAFETY: test mock — Supabase client stub with typed query builder
      return stub as never;
    });

    const newCount = await incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' });

    expect(newCount).toBe(2);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalled();
    expect(mockRpc.mock.calls[0][0]).toBe('increment_consecutive_not_found');
    expect(mockRpc.mock.calls[1][0]).toBe('increment_consecutive_not_found');
  });

  it('term scoping: different terms use correct p_term param', async () => {
    mockRpc.mockResolvedValue({ data: 1, error: null });

    await incrementConsecutiveNotFound({ class_nbr: '76337', term: '2261' });
    expect(mockRpc).toHaveBeenCalledWith('increment_consecutive_not_found', {
      p_class_nbr: '76337',
      p_term: '2261',
    });

    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: 2, error: null });
    await incrementConsecutiveNotFound({ class_nbr: '76337', term: '2257' });
    expect(mockRpc).toHaveBeenCalledWith('increment_consecutive_not_found', {
      p_class_nbr: '76337',
      p_term: '2257',
    });
    // ensure not called with previous term 2261 in this call
    expect(mockRpc).not.toHaveBeenCalledWith('increment_consecutive_not_found', {
      p_class_nbr: '76337',
      p_term: '2261',
    });
  });

  it('throws on non-notFound RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'deadlock', code: '40P01' } });

    await expect(
      incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Failed to increment consecutive_not_found_count');
  });

  it('generic insert failure (42501) throws', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Section not found', code: 'P0001' },
    });
    const insert = vi.fn().mockResolvedValue({ error: { code: '42501', message: 'permission denied' } });
    mockFrom.mockImplementation(() => {
      // SAFETY: test mock — Supabase client stub with typed query builder
      const stub = { insert } as unknown;
      // SAFETY: test mock — Supabase client stub with typed query builder
      return stub as never;
    });

    await expect(
      incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Failed to increment consecutive_not_found_count');
  });

  it('RPC returns null throws validation', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await expect(
      incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Invalid increment result');
  });

  it('RPC returns string throws validation', async () => {
    // SAFETY: test mock — intentionally returns non-number to trigger validation branch
    mockRpc.mockResolvedValue({ data: 'not-a-number' as unknown as number, error: null });

    await expect(
      incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Invalid increment result');
  });

  it('race retry RPC returns null throws validation', async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'Section not found', code: 'P0001' },
      })
      .mockResolvedValueOnce({ data: null, error: null });
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    mockFrom.mockImplementation(() => {
      // SAFETY: test mock — Supabase client stub with typed query builder
      const stub = { insert } as unknown;
      // SAFETY: test mock — Supabase client stub with typed query builder
      return stub as never;
    });

    await expect(
      incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Invalid increment result');
  });

  it('generic P0001 without Section not found message throws (OR masking fixed)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'some other error', code: 'P0001' } });

    await expect(
      incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Failed to increment consecutive_not_found_count');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('handles Section not found via message without code (fallback)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      // no code — message-only path must still trigger insert
      error: { message: 'Section not found: 99999' } as { message: string; code?: string },
    });
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation(() => {
      // SAFETY: test mock — Supabase client stub with typed query builder
      const stub = { insert } as unknown;
      // SAFETY: test mock — Supabase client stub with typed query builder
      return stub as never;
    });

    const newCount = await incrementConsecutiveNotFound({ class_nbr: '99999', term: '2261' });
    expect(newCount).toBe(1);
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
