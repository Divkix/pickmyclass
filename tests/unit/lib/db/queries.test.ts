import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

// Mock the Hyperdrive-backed db client seam (replaces the former Supabase service client)
const { mockCallFunctionScalar, mockExecute, mockGetClient } = vi.hoisted(() => ({
  mockCallFunctionScalar: vi.fn(),
  mockExecute: vi.fn(),
  mockGetClient: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  callFunction: vi.fn(),
  callFunctionScalar: mockCallFunctionScalar,
  query: vi.fn(),
  queryOne: vi.fn(),
  queryScalar: vi.fn(),
  execute: mockExecute,
  getClient: mockGetClient,
  setConnectionStringGetter: vi.fn(),
}));

import {
  deleteSectionAndWatches,
  incrementConsecutiveNotFound,
  resetConsecutiveNotFound,
} from '@/lib/db/queries';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.clearAllMocks();
});

describe('incrementConsecutiveNotFound', () => {
  it('atomic RPC success: calls increment_consecutive_not_found with SectionRef and returns new count', async () => {
    mockCallFunctionScalar.mockResolvedValue(3);

    const newCount = await incrementConsecutiveNotFound({ class_nbr: '76337', term: '2261' });

    expect(newCount).toBe(3);
    expect(mockCallFunctionScalar).toHaveBeenCalledWith('increment_consecutive_not_found', [
      '76337',
      '2261',
    ]);
    expect(mockCallFunctionScalar).toHaveBeenCalledTimes(1);
  });

  it('when row does not exist (Section not found) creates via insert with count=1 and SectionRef', async () => {
    mockCallFunctionScalar.mockRejectedValue(new Error('Section not found'));
    mockExecute.mockResolvedValue(1);

    const newCount = await incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' });

    expect(newCount).toBe(1);
    expect(mockCallFunctionScalar).toHaveBeenCalledWith('increment_consecutive_not_found', [
      '42737',
      '2261',
    ]);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO class_states'),
      expect.arrayContaining(['42737', '2261', 1])
    );
  });

  it('handles 23505 race after insert by retrying atomic RPC', async () => {
    mockCallFunctionScalar
      .mockRejectedValueOnce(new Error('Section not found'))
      .mockResolvedValueOnce(2);
    mockExecute.mockRejectedValue(new Error('23505 duplicate key'));

    const newCount = await incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' });

    expect(newCount).toBe(2);
    expect(mockCallFunctionScalar).toHaveBeenCalledTimes(2);
    expect(mockExecute).toHaveBeenCalled();
    expect(mockCallFunctionScalar.mock.calls[0][0]).toBe('increment_consecutive_not_found');
    expect(mockCallFunctionScalar.mock.calls[1][0]).toBe('increment_consecutive_not_found');
  });

  it('term scoping: different terms use correct term param', async () => {
    mockCallFunctionScalar.mockResolvedValue(1);

    await incrementConsecutiveNotFound({ class_nbr: '76337', term: '2261' });
    expect(mockCallFunctionScalar).toHaveBeenCalledWith('increment_consecutive_not_found', [
      '76337',
      '2261',
    ]);

    vi.clearAllMocks();
    mockCallFunctionScalar.mockResolvedValue(2);
    await incrementConsecutiveNotFound({ class_nbr: '76337', term: '2257' });
    expect(mockCallFunctionScalar).toHaveBeenCalledWith('increment_consecutive_not_found', [
      '76337',
      '2257',
    ]);
    // ensure not called with previous term 2261 in this call
    expect(mockCallFunctionScalar).not.toHaveBeenCalledWith('increment_consecutive_not_found', [
      '76337',
      '2261',
    ]);
  });

  it('throws on non-notFound RPC error', async () => {
    mockCallFunctionScalar.mockRejectedValue(new Error('deadlock'));

    await expect(
      incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Failed to increment consecutive_not_found_count');
  });

  it('generic insert failure (42501) throws', async () => {
    mockCallFunctionScalar.mockRejectedValue(new Error('Section not found'));
    const insertError = new Error('permission denied');
    // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double attaches a pg error code to a plain Error
    (insertError as { code?: string }).code = '42501';
    mockExecute.mockRejectedValue(insertError);

    await expect(
      incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Failed to increment consecutive_not_found_count');
  });

  it('RPC returns null throws validation', async () => {
    mockCallFunctionScalar.mockResolvedValue(null);

    await expect(
      incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Invalid increment result');
  });

  it('RPC returns string throws validation', async () => {
    mockCallFunctionScalar.mockResolvedValue('not-a-number');

    await expect(
      incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Invalid increment result');
  });

  it('race retry RPC returns null throws validation', async () => {
    mockCallFunctionScalar
      .mockRejectedValueOnce(new Error('Section not found'))
      .mockResolvedValueOnce(null);
    mockExecute.mockRejectedValue(new Error('23505 duplicate key'));

    await expect(
      incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Invalid increment result');
  });

  it('generic P0001 without Section not found message throws (OR masking fixed)', async () => {
    mockCallFunctionScalar.mockRejectedValue(new Error('some other error'));

    await expect(
      incrementConsecutiveNotFound({ class_nbr: '42737', term: '2261' })
    ).rejects.toThrow('Failed to increment consecutive_not_found_count');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('handles Section not found via message without code (fallback)', async () => {
    mockCallFunctionScalar.mockRejectedValue(new Error('Section not found: 99999'));
    mockExecute.mockResolvedValue(1);

    const newCount = await incrementConsecutiveNotFound({ class_nbr: '99999', term: '2261' });
    expect(newCount).toBe(1);
  });
});

describe('resetConsecutiveNotFound', () => {
  it('sets consecutive_not_found_count to 0, SectionRef-scoped', async () => {
    mockExecute.mockResolvedValue(0);

    await resetConsecutiveNotFound({ class_nbr: '42737', term: '2261' });

    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('UPDATE class_states'), [
      '42737',
      '2261',
    ]);
  });
});

describe('deleteSectionAndWatches', () => {
  it('deletes class_watches then class_states, both SectionRef-scoped, and returns counts', async () => {
    const mockClientQuery = vi.fn();
    const mockRelease = vi.fn();
    mockGetClient.mockResolvedValue({ query: mockClientQuery, release: mockRelease });
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rowCount: 0 });
      if (sql.includes('class_watches')) return Promise.resolve({ rowCount: 2 });
      if (sql.includes('class_states')) return Promise.resolve({ rowCount: 1 });
      return Promise.resolve({ rowCount: 0 });
    });

    const result = await deleteSectionAndWatches({ class_nbr: '42737', term: '2261' });

    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM class_watches'),
      ['42737', '2261']
    );
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM class_states'),
      ['42737', '2261']
    );

    expect(result).toEqual({ watchesDeleted: 2, stateDeleted: true });
    // verify order: watches deleted before state (client.query call order)
    expect(mockClientQuery.mock.calls[1][0]).toContain('class_watches');
    expect(mockClientQuery.mock.calls[2][0]).toContain('class_states');
    expect(mockRelease).toHaveBeenCalled();
  });

  it('SectionRef-scoped WHERE verified (both fields) for delete', async () => {
    const mockClientQuery = vi.fn();
    const mockRelease = vi.fn();
    mockGetClient.mockResolvedValue({ query: mockClientQuery, release: mockRelease });
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rowCount: 0 });
      return Promise.resolve({ rowCount: 0 });
    });

    await deleteSectionAndWatches({ class_nbr: '99999', term: '2261' });

    expect(mockClientQuery).toHaveBeenCalledWith(expect.stringContaining('class_watches'), [
      '99999',
      '2261',
    ]);
    expect(mockClientQuery).toHaveBeenCalledWith(expect.stringContaining('class_states'), [
      '99999',
      '2261',
    ]);
  });
});
