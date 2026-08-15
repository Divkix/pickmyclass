'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Debounced local mirror of a URL-driven `search` param.
 *
 * Keeps a responsive local input value while debouncing propagation to
 * the URL (via `onChange`). Syncs back when the external `value` changes
 * (e.g. clear button or navigation).
 *
 * `onChange` should be stable — wrap the caller with `useCallback` so the
 * debounced callback identity remains stable across renders.
 */
export function useDebouncedSearchParam(
  value: string,
  onChange: (v: string) => void,
  delayMs = 350
): [string, (v: string) => void] {
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<number | undefined>(undefined);

  // Sync local state when the URL-driven value changes (e.g. clear button)
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Cleanup pending timeout on unmount
  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
    };
  }, []);

  const setValue = useCallback(
    (v: string) => {
      setLocalValue(v);
      clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        onChange(v);
      }, delayMs);
    },
    [onChange, delayMs]
  );

  return [localValue, setValue];
}
