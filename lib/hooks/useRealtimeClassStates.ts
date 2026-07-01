'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { sectionRefKey } from '@/lib/section-ref';
import { createClient } from '@/lib/supabase/client';
import type { ClassStateRow } from '@/lib/types/class-watch';

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

  // Fetch initial data
  const fetchClassStates = useCallback(async () => {
    const supabase = createClient();
    if (classNumbers.length === 0) {
      setClassStates({});
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('class_states')
        .select('*')
        .in('class_nbr', classNumbers);

      if (fetchError) throw fetchError;

      // Convert array to object keyed by sectionRefKey so states for the same
      // class_nbr in different terms don't collide.
      const statesMap = (data || []).reduce(
        (acc, state) => {
          acc[sectionRefKey(state)] = state;
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
  }, [classNumbers]);

  useEffect(() => {
    if (!enabled) return;

    // Initial fetch
    void fetchClassStates();

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
              const newState = payload.new as ClassStateRow;
              setClassStates((prev) => ({
                ...prev,
                [sectionRefKey(newState)]: newState,
              }));
            } else if (payload.eventType === 'DELETE') {
              const oldState = payload.old as ClassStateRow;
              setClassStates((prev) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { [sectionRefKey(oldState)]: _deleted, ...rest } = prev;
                return rest;
              });
            }
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') void fetchClassStates();
        });
    }

    // Cleanup subscription on unmount or when dependencies change
    return () => {
      if (channel) {
        void channel.unsubscribe();
        void supabase.removeChannel(channel);
      }
    };
  }, [enabled, classNumbersKey, fetchClassStates]);

  return {
    classStates,
    loading,
    error,
    refetch: fetchClassStates,
  };
}
