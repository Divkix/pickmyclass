import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { getSectionsToCheck } from '@/lib/db/queries';

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

describe('getSectionsToCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call get_sections_to_check RPC with stagger_type parameter', async () => {
    const mockData = [
      { class_nbr: '12345', term: '2261' },
      { class_nbr: '12346', term: '2261' },
    ];
    mockCallFunction.mockResolvedValue(mockData);

    const result = await getSectionsToCheck('even');

    expect(mockCallFunction).toHaveBeenCalledWith('get_sections_to_check', ['even']);
    expect(result).toEqual(mockData);
  });

  it('should return an empty RPC result', async () => {
    mockCallFunction.mockResolvedValue([]);

    const result = await getSectionsToCheck('even');

    expect(result).toEqual([]);
  });

  it('should throw error when RPC fails', async () => {
    mockCallFunction.mockRejectedValue(new Error('Database connection failed'));

    await expect(getSectionsToCheck('odd')).rejects.toThrow(
      'Failed to fetch sections: Database connection failed'
    );
  });
});
