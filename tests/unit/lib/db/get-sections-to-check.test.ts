import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { getSectionsToCheck } from '@/lib/db/queries';

// Mock Supabase service client
const mockRpc = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    rpc: mockRpc,
  })),
}));

describe('getSectionsToCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call get_sections_to_check RPC with stagger_type parameter', async () => {
    const mockData = [
      { class_nbr: '12345', term: '2261' },
      { class_nbr: '12346', term: '2261' },
    ];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const result = await getSectionsToCheck('even');

    expect(mockRpc).toHaveBeenCalledWith('get_sections_to_check', {
      stagger_type: 'even',
    });
    expect(result).toEqual(mockData);
  });

  it('should return an empty RPC result', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await getSectionsToCheck('even');

    expect(result).toEqual([]);
  });

  it('should throw error when RPC fails', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Database connection failed' },
    });

    await expect(getSectionsToCheck('odd')).rejects.toThrow(
      'Failed to fetch sections: Database connection failed'
    );
  });
});
