'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sectionRefKey } from '@/lib/section-ref';
import type { ClassStateRow } from '@/lib/types/class-watch';

// eslint-disable-next-line anti-slop/no-unknown-parameters, ts-no-tiny-functions -- SAFETY: 3+ call sites need lockstep fallback (fetch + dedup); centralizes ??0 invariant for consecutive_not_found_count
function normalizeConsecutiveCount(row: unknown): number {
  // SAFETY: API response may omit column; narrow to optional count shape — fallback to 0 preserves invariant
  return (row as { consecutive_not_found_count?: number | null }).consecutive_not_found_count ?? 0;
}

interface UseRealtimeClassStatesOptions {
  classNumbers: string[];
  enabled?: boolean;
}

interface UseRealtimeClassStatesReturn {
  classStates: Record<string, ClassStateRow>;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

const POLL_INTERVAL_MS = 60_000;

export function useRealtimeClassStates({
  classNumbers,
  enabled = true,
}: UseRealtimeClassStatesOptions): UseRealtimeClassStatesReturn {
  const [classStates, setClassStates] = useState<Record<string, ClassStateRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const classNumbersKey = useMemo(() => classNumbers.join(','), [classNumbers]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchClassStates = useCallback(async (key: string) => {
    if (!key) {
      setClassStates({});
      setLoading(false);
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `/api/class-watches/states?classNumbers=${encodeURIComponent(key)}`,
        { signal: controller.signal }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch class states: ${response.status}`);
      }

      // SAFETY: API response shape is controlled by our own endpoint; cast the JSON to the expected shape
      const data = (await response.json()) as {
        classStates: ClassStateRow[];
      };

      const typedRows = data.classStates || [];
      const statesMap = typedRows.reduce(
        (acc, state) => {
          const normalized: ClassStateRow = {
            ...state,
            consecutive_not_found_count: normalizeConsecutiveCount(state),
          };
          acc[sectionRefKey(normalized)] = normalized;
          return acc;
        },
        // SAFETY: empty object is the initial typed accumulator for the keyed map
        {} as Record<string, ClassStateRow>
      );

      if (!controller.signal.aborted) {
        setClassStates(statesMap);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err : new Error('Failed to fetch class states'));
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    void fetchClassStates(classNumbersKey);

    const intervalId = setInterval(() => {
      void fetchClassStates(classNumbersKey);
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      abortControllerRef.current?.abort();
    };
  }, [enabled, classNumbersKey, fetchClassStates]);

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
