'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useDebouncedSearchParam(
  value: string,
  onChange: (v: string) => void,
  delayMs = 350
): [string, (v: string) => void] {
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

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
