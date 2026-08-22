import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { useRealtimeClassStates } from '@/lib/hooks/useRealtimeClassStates';
import type { ClassStateRow } from '@/lib/types/class-watch';

// Build a minimal ClassStateRow with sensible defaults for test brevity.
function makeRow(
  overrides: Partial<ClassStateRow> & { class_nbr: string; term: string }
): ClassStateRow {
  return {
    id: `${overrides.term}-${overrides.class_nbr}`,
    subject: 'CSE',
    catalog_nbr: '110',
    title: 'Intro to Programming',
    instructor_name: 'Dr. Smith',
    seats_available: 5,
    seats_capacity: 30,
    non_reserved_seats: null,
    location: 'TBD',
    meeting_times: 'MWF 10:00-11:00',
    last_checked_at: new Date().toISOString(),
    last_changed_at: new Date().toISOString(),
    consecutive_not_found_count: 0,
    ...overrides,
  };
}

// Build a fetch Response mock returning the given classStates payload.
function fetchResponse(classStates: ClassStateRow[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ classStates }),
  } as Response;
}

describe('useRealtimeClassStates hook', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  describe('initial fetch on mount', () => {
    it('fetches states on mount and populates classStates keyed by sectionRefKey', async () => {
      const row = makeRow({ class_nbr: '12345', term: '2261', seats_available: 10 });
      vi.mocked(global.fetch).mockResolvedValue(fetchResponse([row]));

      const { result } = renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      await waitFor(() => {
        expect(Object.keys(result.current.classStates)).toHaveLength(1);
      });

      // Keyed by term:class_nbr (sectionRefKey), not class_nbr alone
      expect(result.current.classStates['2261:12345']).toBeDefined();
      expect(result.current.classStates['2261:12345'].seats_available).toBe(10);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('fetches from /api/class-watches/states with encoded classNumbers query', async () => {
      vi.mocked(global.fetch).mockResolvedValue(fetchResponse([]));

      renderHook(() => useRealtimeClassStates({ classNumbers: ['12345', '67890'] }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      const calledUrl = vi.mocked(global.fetch).mock.calls[0]![0] as string;
      expect(calledUrl).toContain('/api/class-watches/states');
      expect(calledUrl).toContain('classNumbers=12345%2C67890');
    });

    it('sets loading to false after a successful fetch', async () => {
      vi.mocked(global.fetch).mockResolvedValue(fetchResponse([]));

      const { result } = renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe('per-term keying (issue #279)', () => {
    // Two Class States sharing a class_nbr across terms; keyed by class_nbr
    // alone they would collide, one overwriting the other.
    const spring = makeRow({ class_nbr: '12345', term: '2261', seats_available: 5 });
    const fall = makeRow({ class_nbr: '12345', term: '2267', seats_available: 0 });

    it('keeps two states sharing a class_nbr across terms in separate slots', async () => {
      vi.mocked(global.fetch).mockResolvedValue(fetchResponse([spring, fall]));

      const { result } = renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      await waitFor(() => {
        expect(Object.keys(result.current.classStates)).toHaveLength(2);
      });

      // Each term keeps its own seats — no overwrite.
      expect(result.current.classStates['2261:12345'].seats_available).toBe(5);
      expect(result.current.classStates['2267:12345'].seats_available).toBe(0);
    });

    it('reflects updated data from a subsequent poll in the correct term slot', async () => {
      // First poll: spring has 5, fall has 0
      vi.mocked(global.fetch).mockResolvedValueOnce(fetchResponse([spring, fall]));

      const { result } = renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      await waitFor(() => {
        expect(Object.keys(result.current.classStates)).toHaveLength(2);
      });

      // Second poll: fall gains a seat (4), spring unchanged
      vi.mocked(global.fetch).mockResolvedValueOnce(
        fetchResponse([spring, makeRow({ class_nbr: '12345', term: '2267', seats_available: 4 })])
      );

      await act(async () => {
        await result.current.refetch();
      });

      expect(result.current.classStates['2267:12345'].seats_available).toBe(4);
      expect(result.current.classStates['2261:12345'].seats_available).toBe(5);
    });
  });

  describe('polling interval', () => {
    it('re-fetches on each polling interval', async () => {
      vi.useFakeTimers();
      vi.mocked(global.fetch).mockResolvedValue(fetchResponse([]));

      renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      // Initial fetch
      await vi.waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      // Advance past the 60s poll interval
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);

      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });

      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('cleanup on unmount', () => {
    it('stops polling when the hook unmounts', async () => {
      vi.useFakeTimers();
      vi.mocked(global.fetch).mockResolvedValue(fetchResponse([]));

      const { unmount } = renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      await vi.waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      unmount();

      // Advancing the timer after unmount should NOT trigger another fetch
      await act(async () => {
        vi.advanceTimersByTime(120_000);
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('enabled flag', () => {
    it('does not fetch when enabled is false', async () => {
      const { result } = renderHook(() =>
        useRealtimeClassStates({ classNumbers: ['12345'], enabled: false })
      );

      // Give microtasks a chance to flush
      await Promise.resolve();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(result.current.classStates).toEqual({});
    });
  });

  describe('empty classNumbers', () => {
    it('does not fetch and returns empty states when classNumbers is empty', async () => {
      const { result } = renderHook(() => useRealtimeClassStates({ classNumbers: [] }));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(result.current.classStates).toEqual({});
    });
  });

  describe('error handling', () => {
    it('sets error when fetch returns a non-ok response', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      const { result } = renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      await waitFor(() => {
        expect(result.current.error).not.toBeNull();
      });

      expect(result.current.error?.message).toContain('500');
      expect(result.current.loading).toBe(false);
    });

    it('sets error when fetch throws a network error', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('network down'));

      const { result } = renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      await waitFor(() => {
        expect(result.current.error).not.toBeNull();
      });

      expect(result.current.error?.message).toBe('network down');
    });
  });

  describe('refetch', () => {
    it('refetch triggers a new fetch call', async () => {
      vi.mocked(global.fetch).mockResolvedValue(fetchResponse([]));

      const { result } = renderHook(() => useRealtimeClassStates({ classNumbers: ['12345'] }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        await result.current.refetch();
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
