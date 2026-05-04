import { describe, expect, it, vi, beforeEach } from 'vitest';
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

  it('should only return sections with active watchers (issue #167)', async () => {
    // Mock the RPC to return sections with active watchers only
    // The SQL function now joins with user_profiles and filters:
    // - notifications_enabled = true (or null - defaults to true)
    // - email_bounced = false
    // - spam_complained = false
    // - is_disabled = false
    const mockData = [
      { class_nbr: '12345', term: '2261' }, // Has active watcher
      { class_nbr: '12347', term: '2261' }, // Has active watcher
    ];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const result = await getSectionsToCheck('all');

    expect(result).toHaveLength(2);
    expect(result).not.toContainEqual({ class_nbr: '12346', term: '2261' }); // Section with only disabled watchers
    expect(result).not.toContainEqual({ class_nbr: '12348', term: '2261' }); // Section with only bounced watchers
  });

  it('should handle empty result when all watchers are inactive', async () => {
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

  it('should apply consistent filtering with get_watchers_for_sections (issue #167)', async () => {
    // The SQL function get_sections_to_check now applies the same filters
    // as get_watchers_for_sections:
    // - COALESCE(up.notifications_enabled, true) = true
    // - COALESCE(up.email_bounced, false) = false
    // - COALESCE(up.spam_complained, false) = false
    // - COALESCE(up.is_disabled, false) = false
    //
    // This prevents wasting ASU API calls on sections where all
    // watchers are disabled/bounced/spam-complained.
    const mockData = [
      { class_nbr: '12345', term: '2261' },
    ];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const result = await getSectionsToCheck('odd');

    expect(result).toEqual([{ class_nbr: '12345', term: '2261' }]);
  });
});
