import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRealtimeClassStates } from '@/lib/hooks/useRealtimeClassStates';

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
});
