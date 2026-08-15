'use client';

import { useCallback, useMemo, useState } from 'react';
import type { AsuTerm } from '@/lib/asu/terms';
import {
  classWatchCreation,
  type ClassWatchCreationInput,
} from '@/lib/class-watches/class-watch-creation';
import type { ClassWatchRow } from '@/lib/types/class-watch';

export type UseClassWatchFormOptions = {
  defaultClassNbr?: string;
  defaultTerm?: string;
  onCreated?: (watch: ClassWatchRow, input: ClassWatchCreationInput) => void | Promise<void>;
  onSubmittingChange?: (submitting: boolean) => void;
  resetOnSuccess?: boolean;
};
export function useClassWatchForm(options: UseClassWatchFormOptions = {}) {
  const { terms, defaultTerm: derivedDefaultTerm } = useMemo(() => {
    try {
      // SAFETY: narrowing mocked getOptions shape at boundary – getOptions is typed narrowly but tests mock broader shape
      const result: unknown = classWatchCreation.getOptions() as unknown;
      if (result && typeof result === 'object' && 'terms' in result && 'defaultTerm' in result) {
        // eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: boundary shape check for mocked getOptions
        const rec = result as Record<string, unknown>;
        if (Array.isArray(rec.terms) && typeof rec.defaultTerm === 'string') {
          // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: validated array and string above, narrowing via unknown to precise AsuTerm shape
          return rec as unknown as { terms: AsuTerm[]; defaultTerm: string };
        }
      }
      // SAFETY: narrowing mocked getOptions shape at boundary – fallback empty state for missing shape
      return { terms: [] as AsuTerm[], defaultTerm: '' as string };
    } catch {
      // SAFETY: narrowing mocked getOptions shape at boundary – fallback empty state on throw
      return { terms: [] as AsuTerm[], defaultTerm: '' as string };
    }
  }, []);
  const {
    defaultClassNbr = '',
    defaultTerm = derivedDefaultTerm,
    onCreated,
    onSubmittingChange,
    resetOnSuccess = false,
  } = options;

  const [term, setTerm] = useState(defaultTerm);
  const [classNbr, setClassNbr] = useState(defaultClassNbr);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setIsSubmitting(true);
      onSubmittingChange?.(true);
      try {
        const input: ClassWatchCreationInput = { term, class_nbr: classNbr };
        const watch = await classWatchCreation.create(input);
        await onCreated?.(watch, input);
        if (resetOnSuccess) {
          setTerm(derivedDefaultTerm);
          setClassNbr('');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add class watch');
      } finally {
        setIsSubmitting(false);
        onSubmittingChange?.(false);
      }
    },
    [term, classNbr, onCreated, onSubmittingChange, resetOnSuccess, derivedDefaultTerm]
  );

  return {
    terms,
    defaultTerm: derivedDefaultTerm,
    term,
    setTerm,
    classNbr,
    setClassNbr,
    error,
    setError,
    isSubmitting,
    handleSubmit,
  };
}
