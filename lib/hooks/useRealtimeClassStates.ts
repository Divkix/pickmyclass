"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { sectionRefKey } from "@/lib/section-ref";
import type { ClassStateRow } from "@/lib/types/class-watch";

const consecutiveCountSchema = z.object({
  consecutive_not_found_count: z.number().nullish(),
});

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

class ClassStatesStatusError extends Error {}

async function requestClassStates(
  key: string,
  signal: AbortSignal,
): Promise<Record<string, ClassStateRow>> {
  const response = await fetch(
    `/api/class-watches/states?classNumbers=${encodeURIComponent(key)}`,
    { signal },
  );

  if (!response.ok) {
    throw new ClassStatesStatusError(`Failed to fetch class states: ${response.status}`);
  }

  // SAFETY: API response shape is controlled by our own endpoint; cast the JSON to the expected shape
  const data = (await response.json()) as {
    classStates: ClassStateRow[];
  };

  const typedRows = data.classStates || [];

  return typedRows.reduce(
    (acc, state) => {
      const parsed = consecutiveCountSchema.safeParse(state);
      const count = parsed.success ? (parsed.data.consecutive_not_found_count ?? 0) : 0;

      const normalized: ClassStateRow = {
        ...state,
        consecutive_not_found_count: count,
      };

      acc[sectionRefKey(normalized)] = normalized;

      return acc;
    },
    // SAFETY: empty object is the initial typed accumulator for the keyed map
    {} as Record<string, ClassStateRow>,
  );
}

export function useRealtimeClassStates({
  classNumbers,
  enabled = true,
}: UseRealtimeClassStatesOptions): UseRealtimeClassStatesReturn {
  const classNumbersKey = useMemo(() => classNumbers.join(","), [classNumbers]);
  const [classStates, setClassStates] = useState<Record<string, ClassStateRow>>({});
  const [loading, setLoading] = useState(!enabled || Boolean(classNumbersKey));
  const [error, setError] = useState<Error | null>(null);
  const [previousInputs, setPreviousInputs] = useState({ classNumbersKey, enabled });
  const abortControllerRef = useRef<AbortController | null>(null);

  if (classNumbersKey !== previousInputs.classNumbersKey || enabled !== previousInputs.enabled) {
    setPreviousInputs({ classNumbersKey, enabled });

    if (enabled) {
      setLoading(Boolean(classNumbersKey));

      if (classNumbersKey) {
        setError(null);
      } else {
        setClassStates({});
      }
    }
  }

  const loadClassStates = useCallback((key: string): Promise<void> => {
    if (!key) return Promise.resolve();

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    return requestClassStates(key, controller.signal)
      .then(
        (statesMap) => {
          if (!controller.signal.aborted) {
            setClassStates(statesMap);
          }
        },
        (err: Error) => {
          if (err instanceof DOMException && err.name === "AbortError") return;

          if (controller.signal.aborted) return;

          // A 403 (revoked watch / auth) or 307 must not leave the last poll's seats on screen
          if (err instanceof ClassStatesStatusError) setClassStates({});

          setError(err instanceof Error ? err : new Error("Failed to fetch class states"));
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
  }, []);

  const fetchClassStates = useCallback(
    async (key: string) => {
      if (!key) {
        setClassStates({});
        setLoading(false);

        return;
      }

      setLoading(true);
      setError(null);
      await loadClassStates(key);
    },
    [loadClassStates],
  );

  useEffect(() => {
    if (!enabled) return;

    void loadClassStates(classNumbersKey);

    const intervalId = setInterval(() => {
      void fetchClassStates(classNumbersKey);
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      abortControllerRef.current?.abort();
    };
  }, [enabled, classNumbersKey, loadClassStates, fetchClassStates]);

  const refetch = useCallback(
    () => fetchClassStates(classNumbersKey),
    [classNumbersKey, fetchClassStates],
  );

  return {
    classStates,
    loading,
    error,
    refetch,
  };
}
