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
    it('should pass a callback to subscribe that re-fetches on SUBSCRIBED status', async () => {
      // This test verifies the fix for issue #177:
      // The subscribe() call should pass a callback that re-fetches on SUBSCRIBED

      let capturedSubscribeCallback: ((status: string) => void) | undefined;
      const subscribeCalls: string[] = [];

      // Create mock channel that captures the subscribe callback
      const mockChannel = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn((callback?: (status: string) => void) => {
          capturedSubscribeCallback = callback;
          // Track that subscribe was called with a callback
          if (callback) {
            subscribeCalls.push('called-with-callback');
          }
          return mockChannel;
        }),
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

      // Render the hook
      renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      // Wait for the subscription to be set up
      await waitFor(() => {
        expect(mockChannel.subscribe).toHaveBeenCalled();
      });

      // Verify that a callback was passed to subscribe
      expect(capturedSubscribeCallback).toBeDefined();
      expect(typeof capturedSubscribeCallback).toBe('function');
      expect(subscribeCalls).toContain('called-with-callback');

      // Simulate reconnection: call the callback with SUBSCRIBED status
      // This is what Supabase Realtime does when WebSocket reconnects
      // We verify the callback handles the SUBSCRIBED status
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(() => capturedSubscribeCallback!('SUBSCRIBED')).not.toThrow();
    });

    it('should only re-fetch on SUBSCRIBED status, not other statuses', async () => {
      let capturedSubscribeCallback: ((status: string) => void) | undefined;
      const fetchCalls: string[] = [];

      // Create stable mock data to avoid re-renders
      const stableData = [{ class_nbr: '12345', seats_available: 10 }];

      const mockChannel = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn((callback?: (status: string) => void) => {
          capturedSubscribeCallback = callback;
          return mockChannel;
        }),
        unsubscribe: vi.fn(),
      };

      mockSupabase.channel.mockReturnValue(mockChannel);
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockImplementation(() => {
            fetchCalls.push('fetch');
            return Promise.resolve({
              data: stableData,
              error: null,
            });
          }),
        }),
      });

      renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      await waitFor(() => {
        expect(capturedSubscribeCallback).toBeDefined();
      });

      // Clear fetch calls after initial setup
      fetchCalls.length = 0;

      // Call with various non-SUBSCRIBED statuses - should not trigger fetches
      if (capturedSubscribeCallback) {
        capturedSubscribeCallback('CLOSED');
        capturedSubscribeCallback('CHANNEL_ERROR');
        capturedSubscribeCallback('TIMED_OUT');
        capturedSubscribeCallback('connecting');
      }

      // Verify no fetches were triggered by non-SUBSCRIBED statuses
      expect(fetchCalls.length).toBe(0);

      // Now call with SUBSCRIBED - this SHOULD trigger a fetch
      if (capturedSubscribeCallback) {
        capturedSubscribeCallback('SUBSCRIBED');
      }

      // Verify a fetch was triggered
      await waitFor(() => {
        expect(fetchCalls.length).toBe(1);
      });
    });
  });

  describe('per-term keying (issue #279)', () => {
    // Two Class States sharing a class_nbr across terms; keyed by class_nbr
    // alone they would collide, one overwriting the other.
    const spring: ClassStateRow = {
      class_nbr: '12345',
      term: '2261',
      seats_available: 5,
    } as ClassStateRow;
    const fall: ClassStateRow = {
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
        on: vi.fn((_event: string, _config: unknown, cb: typeof capturedHandler) => {
          capturedHandler = cb;
          return mockChannel;
        }),
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
