import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { getMostWatchedClass } from '@/lib/db/queries';

// Mock the Hyperdrive-backed db client seam (replaces the former Supabase service client)
const { mockCallFunction } = vi.hoisted(() => ({
  mockCallFunction: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  callFunction: mockCallFunction,
  callFunctionScalar: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  queryScalar: vi.fn(),
  execute: vi.fn(),
  getClient: vi.fn(),
  setConnectionStringGetter: vi.fn(),
}));

describe('getMostWatchedClass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls get_most_watched_class with the supplied term', async () => {
    mockCallFunction.mockResolvedValue([{ class_nbr: '12345', term: '2267' }]);

    const result = await getMostWatchedClass('2267');

    expect(mockCallFunction).toHaveBeenCalledWith('get_most_watched_class', ['2267']);
    expect(result).toEqual({ class_nbr: '12345', term: '2267' });
  });

  it('returns null when no active watches exist for the term', async () => {
    mockCallFunction.mockResolvedValue([]);

    const result = await getMostWatchedClass('2267');

    expect(result).toBeNull();
  });

  it('returns null when the RPC returns no data', async () => {
    mockCallFunction.mockResolvedValue([]);

    const result = await getMostWatchedClass('2267');

    expect(result).toBeNull();
  });

  it('throws when the RPC fails', async () => {
    mockCallFunction.mockRejectedValue(new Error('boom'));

    await expect(getMostWatchedClass('2267')).rejects.toThrow(
      'Failed to fetch most watched class: boom'
    );
  });

  it('returns only the top row (the RPC orders by watcher count desc, limit 1)', async () => {
    // The RPC is expected to LIMIT 1; the helper reads only the first row.
    mockCallFunction.mockResolvedValue([{ class_nbr: '99999', term: '2267' }]);

    const result = await getMostWatchedClass('2267');

    expect(result).toEqual({ class_nbr: '99999', term: '2267' });
  });
});
