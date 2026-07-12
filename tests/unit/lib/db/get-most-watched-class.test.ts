import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { getMostWatchedClass } from '@/lib/db/queries';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    rpc: mockRpc,
  })),
}));

describe('getMostWatchedClass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls get_most_watched_class with the supplied term', async () => {
    mockRpc.mockResolvedValue({ data: [{ class_nbr: '12345', term: '2267' }], error: null });

    const result = await getMostWatchedClass('2267');

    expect(mockRpc).toHaveBeenCalledWith('get_most_watched_class', { p_term: '2267' });
    expect(result).toEqual({ class_nbr: '12345', term: '2267' });
  });

  it('returns null when no active watches exist for the term', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await getMostWatchedClass('2267');

    expect(result).toBeNull();
  });

  it('returns null when the RPC returns no data', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const result = await getMostWatchedClass('2267');

    expect(result).toBeNull();
  });

  it('throws when the RPC fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(getMostWatchedClass('2267')).rejects.toThrow(
      'Failed to fetch most watched class: boom'
    );
  });

  it('returns only the top row (the RPC orders by watcher count desc, limit 1)', async () => {
    // The RPC is expected to LIMIT 1; the helper reads only the first row.
    mockRpc.mockResolvedValue({
      data: [{ class_nbr: '99999', term: '2267' }],
      error: null,
    });

    const result = await getMostWatchedClass('2267');

    expect(result).toEqual({ class_nbr: '99999', term: '2267' });
  });
});
