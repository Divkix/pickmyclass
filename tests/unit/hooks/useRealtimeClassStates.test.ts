import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { useRealtimeClassStates } from '@/lib/hooks/useRealtimeClassStates';
import type { ClassStateRow } from '@/lib/types/class-watch';

// Mock Supabase client
const mockSupabase = {
  from: vi.fn(),
  removeChannel: vi.fn(),
  channel: vi.fn(),
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabase,
}));

describe('useRealtimeClassStates hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('subscribe callback behavior (issue #177)', () => {
    it('should subscribe without a callback (no duplicate fetch on SUBSCRIBED)', async () => {
      const mockChannel = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(() => mockChannel),
        unsubscribe: vi.fn(),
      };

      mockSupabase.channel.mockReturnValue(mockChannel);
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: [{ class_nbr: '12345', seats_available: 10 }],
            error: null,
          }),
        }),
      });

      renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      await waitFor(() => {
        expect(mockChannel.subscribe).toHaveBeenCalled();
      });

      // Production now calls .subscribe() with no callback — single fetch before subscribe
      expect(mockChannel.subscribe).toHaveBeenCalledWith();
      expect(mockChannel.subscribe).toHaveBeenCalledTimes(1);
    });

    it('should fetch only once on mount and not re-fetch on SUBSCRIBED', async () => {
      const fetchCalls: string[] = [];

      const mockChannel = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(() => mockChannel),
        unsubscribe: vi.fn(),
      };

      mockSupabase.channel.mockReturnValue(mockChannel);
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockImplementation(() => {
            fetchCalls.push('fetch');
            return Promise.resolve({
              data: [{ class_nbr: '12345', seats_available: 10 }],
              error: null,
            });
          }),
        }),
      });

      renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      await waitFor(() => {
        expect(mockChannel.subscribe).toHaveBeenCalledWith();
      });

      // Initial mount triggers a single fetch
      expect(fetchCalls.length).toBe(1);

      // No callback was passed to subscribe, so SUBSCRIBED cannot trigger a second fetch
      expect(mockChannel.subscribe.mock.calls[0].length).toBe(0);
      expect(fetchCalls.length).toBe(1);
    });
  });

  describe('per-term keying (issue #279)', () => {
    // Two Class States sharing a class_nbr across terms; keyed by class_nbr
    // alone they would collide, one overwriting the other.
    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    const spring = {
      class_nbr: '12345',
      term: '2261',
      seats_available: 5,
    } as ClassStateRow;
    // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
    const fall = {
      class_nbr: '12345',
      term: '2267',
      seats_available: 0,
    } as ClassStateRow;

    /**
     * Wire the Supabase mock so the initial fetch resolves to `data` and the
     * postgres_changes handler passed to `.on()` is captured for firing events.
     */
    function setup(data: ClassStateRow[]) {
      let capturedHandler:
        | ((payload: {
            eventType: 'INSERT' | 'UPDATE' | 'DELETE';
            new?: ClassStateRow;
            old?: ClassStateRow;
          }) => void)
        | undefined;

      const mockChannel = {
        on: vi.fn(
          // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: mock type guard decodes unknown at I/O boundary
          (_event: string, _config: Record<string, string>, cb: typeof capturedHandler) => {
            capturedHandler = cb;
            return mockChannel;
          }
        ),
        subscribe: vi.fn(() => mockChannel),
        unsubscribe: vi.fn(),
      };
      mockSupabase.channel.mockReturnValue(mockChannel);
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data, error: null }),
        }),
      });

      return { getHandler: () => capturedHandler };
    }

    it('keeps two states sharing a class_nbr across terms in separate slots', async () => {
      setup([spring, fall]);

      const { result } = renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      await waitFor(() => {
        expect(Object.keys(result.current.classStates)).toHaveLength(2);
      });

      // Each term keeps its own seats — no overwrite.
      expect(result.current.classStates['2261:12345'].seats_available).toBe(5);
      expect(result.current.classStates['2267:12345'].seats_available).toBe(0);
    });

    it('applies an UPDATE event to the correct term only', async () => {
      const { getHandler } = setup([spring, fall]);

      const { result } = renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      await waitFor(() => {
        expect(Object.keys(result.current.classStates)).toHaveLength(2);
      });

      // Fall section (2267) gains a seat; spring (2261) must be untouched.
      act(() => {
        getHandler()?.({
          eventType: 'UPDATE',
          new: { ...fall, seats_available: 4 },
        });
      });

      expect(result.current.classStates['2267:12345'].seats_available).toBe(4);
      expect(result.current.classStates['2261:12345'].seats_available).toBe(5);
    });

    it('applies an INSERT event under its own term key', async () => {
      const { getHandler } = setup([spring]);

      const { result } = renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      await waitFor(() => {
        expect(Object.keys(result.current.classStates)).toHaveLength(1);
      });

      act(() => {
        getHandler()?.({ eventType: 'INSERT', new: fall });
      });

      // Insert adds a new term rather than replacing the existing one.
      expect(Object.keys(result.current.classStates)).toHaveLength(2);
      expect(result.current.classStates['2261:12345'].seats_available).toBe(5);
      expect(result.current.classStates['2267:12345'].seats_available).toBe(0);
    });

    it('removes only the deleted term on a DELETE event', async () => {
      const { getHandler } = setup([spring, fall]);

      const { result } = renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      await waitFor(() => {
        expect(Object.keys(result.current.classStates)).toHaveLength(2);
      });

      act(() => {
        getHandler()?.({ eventType: 'DELETE', old: fall });
      });

      // Only the fall section is gone; spring survives.
      expect(result.current.classStates['2267:12345']).toBeUndefined();
      expect(result.current.classStates['2261:12345'].seats_available).toBe(5);
    });
  });
});
