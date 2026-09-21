'use client';

import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import type { AsuTerm } from '@/lib/asu/terms';
import {
  classWatchCreation,
  type ClassWatchCreationInput,
} from '@/lib/class-watches/class-watch-creation';
import type { ClassWatchRow } from '@/lib/types/class-watch';

// Partial on purpose: term elements validate only the fields TermSelect reads (code, label).
const watchOptionsSchema = z.object({
  terms: z.array(z.object({ code: z.string(), label: z.string() })),
  defaultTerm: z.string(),
});

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
      const parsed = watchOptionsSchema.safeParse(classWatchCreation.getOptions());

      if (parsed.success) {
        // SAFETY: schema checked code/label/defaultTerm — every member the watch form reads.
        return parsed.data as { terms: AsuTerm[]; defaultTerm: string };
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
