'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { sectionRefKey } from '@/lib/section-ref';
import { createClient } from '@/lib/supabase/client';
import type { ClassStateRow } from '@/lib/types/class-watch';

// eslint-disable-next-line anti-slop/no-unknown-parameters, ts-no-tiny-functions -- SAFETY: 3+ call sites need lockstep fallback (fetch + realtime dedup + future); centralizes ??0 invariant for consecutive_not_found_count — row is untyped Supabase payload narrowed via cast
function normalizeConsecutiveCount(row: unknown): number {
  // SAFETY: Supabase select may omit column in stale cache; narrow to optional count shape — fallback to 0 preserves invariant
  return (row as { consecutive_not_found_count?: number | null }).consecutive_not_found_count ?? 0;
}

interface UseRealtimeClassStatesOptions {
  classNumbers: string[]; // Array of class_nbr values to monitor
  enabled?: boolean; // Whether to subscribe (default: true)
}

interface UseRealtimeClassStatesReturn {
  // Keyed by sectionRefKey ({ class_nbr, term }) so a section watched in two
  // terms keeps a separate slot instead of one term overwriting the other.
  classStates: Record<string, ClassStateRow>;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to subscribe to real-time updates for specific class states
 * @param options.classNumbers - Array of class_nbr values to monitor
 * @param options.enabled - Whether to enable the subscription (default: true)
 * @returns Object containing classStates, loading state, error, and refetch function
 */
export function useRealtimeClassStates({
  classNumbers,
  enabled = true,
}: UseRealtimeClassStatesOptions): UseRealtimeClassStatesReturn {
  const [classStates, setClassStates] = useState<Record<string, ClassStateRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Memoize the class numbers key for stable dependency tracking
  const classNumbersKey = useMemo(() => classNumbers.join(','), [classNumbers]);

  // Fetch initial data — takes the memoized key string so the callback identity
  // stays stable and the effect does not re-subscribe when the function
  // reference would otherwise change.
  const fetchClassStates = useCallback(async (key: string) => {
    const supabase = createClient();
    if (!key) {
      setClassStates({});
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const numbers = key.split(',').filter(Boolean);

      const { data, error: fetchError } = await supabase
        .from('class_states')
        .select(
          'id, class_nbr, term, subject, catalog_nbr, title, instructor_name, seats_available, seats_capacity, non_reserved_seats, location, meeting_times, last_checked_at, last_changed_at, consecutive_not_found_count'
        )
        .in('class_nbr', numbers);

      if (fetchError) throw fetchError;

      // Convert array to object keyed by sectionRefKey so states for the same
      // class_nbr in different terms don't collide.
      // SAFETY: Supabase select result is untyped response data; widen to unknown before narrowing to typed rows — verified via select columns matching ClassStateRow
      const rawData: unknown = data as unknown;
      // SAFETY: Supabase select returns ClassStateRow array per table contract; narrow unknown to typed rows with fallback
      const typedRows = (rawData as ClassStateRow[]) || [];
      // SAFETY: empty object is initial typed accumulator for keyed map; reduce populates valid entries per sectionRefKey — invariant holds via ClassStateRow contract
      const statesMap = typedRows.reduce(
        (acc, state) => {
          const normalized: ClassStateRow = {
            ...state,
            // SAFETY: Supabase select may omit column in stale cache; narrow to optional count shape — fallback to 0 preserves invariant
            consecutive_not_found_count: normalizeConsecutiveCount(state),
          };
          acc[sectionRefKey(normalized)] = normalized;
          return acc;
        },
        {} as Record<string, ClassStateRow>
      );

      setClassStates(statesMap);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch class states'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Initial fetch — single network call on mount; no second fetch on SUBSCRIBED
    void fetchClassStates(classNumbersKey);

    // Set up real-time subscription
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;

    if (classNumbersKey) {
      channel = supabase
        .channel('class_states_changes')
        .on(
          'postgres_changes',
          {
            event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
            schema: 'public',
            table: 'class_states',
            filter: `class_nbr=in.(${classNumbersKey})`,
          },
          (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              // SAFETY: Realtime payload shape matches class_states row by Supabase contract
              const raw = payload.new as ClassStateRow & {
                consecutive_not_found_count?: number | null;
              };
              const newState: ClassStateRow = {
                ...raw,
                // SAFETY: Realtime payload may omit column in stale cache; narrow to optional count shape — fallback to 0 preserves invariant
                consecutive_not_found_count: normalizeConsecutiveCount(raw),
              };
              const key = sectionRefKey(newState);
              setClassStates((prev) => {
                const existing = prev[key];
                if (
                  existing &&
                  existing.seats_available === newState.seats_available &&
                  existing.non_reserved_seats === newState.non_reserved_seats &&
                  existing.instructor_name === newState.instructor_name &&
                  existing.consecutive_not_found_count === newState.consecutive_not_found_count
                ) {
                  return prev;
                }
                return {
                  ...prev,
                  [key]: newState,
                };
              });
            } else if (payload.eventType === 'DELETE') {
              // Deleting relies on `payload.old` (the deleted row), which is only
              // delivered when `class_states` has REPLICA IDENTITY FULL. Latent
              // today — nothing deletes class_states rows.
              // SAFETY: Realtime payload shape matches class_states row by Supabase contract
              const oldState = payload.old as ClassStateRow;
              const key = sectionRefKey(oldState);
              setClassStates((prev) => {
                if (!(key in prev)) return prev;
                const { [key]: _deleted, ...rest } = prev;
                void _deleted;
                return rest;
              });
            }
          }
        )
        .subscribe();
    }

    // Cleanup subscription on unmount or when dependencies change
    return () => {
      if (channel) {
        void channel.unsubscribe();
        void supabase.removeChannel(channel);
      }
    };
  }, [enabled, classNumbersKey]);

  const refetch = useCallback(
    () => fetchClassStates(classNumbersKey),
    [classNumbersKey, fetchClassStates]
  );

  return {
    classStates,
    loading,
    error,
    refetch,
  };
}
