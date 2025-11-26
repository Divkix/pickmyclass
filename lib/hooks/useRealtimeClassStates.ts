'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';

type ClassState = Database['public']['Tables']['class_states']['Row'];

interface UseRealtimeClassStatesOptions {
  classNumbers: string[]; // Array of class_nbr values to monitor
  enabled?: boolean; // Whether to subscribe (default: true)
}

interface UseRealtimeClassStatesReturn {
  classStates: Record<string, ClassState>; // Keyed by class_nbr for easy lookup
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
  const [classStates, setClassStates] = useState<Record<string, ClassState>>({});
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

      // Convert array to object keyed by class_nbr
      const statesMap = (data || []).reduce(
        (acc, state) => {
          acc[state.class_nbr] = state;
          return acc;
        },
        {} as Record<string, ClassState>
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
    fetchClassStates();

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
            console.log('Real-time update received:', payload);

            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const newState = payload.new as ClassState;
              setClassStates((prev) => ({
                ...prev,
                [newState.class_nbr]: newState,
              }));
            } else if (payload.eventType === 'DELETE') {
              const oldState = payload.old as ClassState;
              setClassStates((prev) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { [oldState.class_nbr]: _deleted, ...rest } = prev;
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
        supabase.removeChannel(channel);
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
