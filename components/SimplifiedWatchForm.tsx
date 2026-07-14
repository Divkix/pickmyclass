'use client';

import { useMemo, useState } from 'react';
import { formatTermOption } from '@/lib/asu/terms';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  classWatchCreation,
  type ClassWatchCreationInput,
} from '@/lib/class-watches/class-watch-creation';
import type { ClassWatchRow } from '@/lib/types/class-watch';

interface SimplifiedWatchFormProps {
  /** Runs caller-specific state/analytics after the watch is created. */
  onCreated: (watch: ClassWatchRow, input: ClassWatchCreationInput) => void | Promise<void>;
  /** Exposes the complete request lifecycle to containers that gate other actions. */
  onSubmittingChange?: (submitting: boolean) => void;
  /** Optional pre-filled class number (e.g. from a "Track this class" shortcut). */
  defaultClassNbr?: string;
  submitLabel?: string;
  submittingLabel?: string;
}

/**
 * Minimal class-watch form (class number + term only). Shares the same
 * validation rules as the dashboard's `AddClassWatch` (exactly 5 digits, a
 * selectable term, and the "No terms are currently available" fallback) so
 * onboarding cannot create a broken watch.
 */
export function SimplifiedWatchForm({
  onCreated,
  onSubmittingChange,
  defaultClassNbr = '',
  submitLabel = 'Start Watching',
  submittingLabel = "Checking ASU's class search... hang tight",
}: SimplifiedWatchFormProps) {
  const { terms: selectableTerms, defaultTerm } = useMemo(
    () => classWatchCreation.getOptions(),
    []
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState(defaultTerm);
  const [classNbr, setClassNbr] = useState(defaultClassNbr);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    setIsSubmitting(true);
    onSubmittingChange?.(true);
    try {
      const input = { term, class_nbr: classNbr };
      const watch = await classWatchCreation.create(input);
      await onCreated(watch, input);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add class watch');
    } finally {
      setIsSubmitting(false);
      onSubmittingChange?.(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <Alert className="bg-destructive/10 text-destructive border-destructive/30">{error}</Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="onboarding-term">Term *</Label>
        {selectableTerms.length === 0 ? (
          <Alert className="bg-destructive/10 text-destructive border-destructive/30">
            No terms are currently available. Please check back later or contact support.
          </Alert>
        ) : (
          <Select value={term} onValueChange={setTerm} required>
            <SelectTrigger id="onboarding-term">
              <SelectValue placeholder="Select term" />
            </SelectTrigger>
            <SelectContent>
              {selectableTerms.map((termOption) => (
                <SelectItem key={termOption.code} value={termOption.code}>
                  {formatTermOption(termOption)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">Select the term to monitor</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="onboarding-class-nbr">Class Number *</Label>
        <Input
          id="onboarding-class-nbr"
          placeholder="19439"
          value={classNbr}
          onChange={(e) => setClassNbr(e.target.value)}
          required
          maxLength={5}
          pattern="\d{5}"
          inputMode="numeric"
          title="Must be a 5-digit class number"
        />
        <p className="text-xs text-muted-foreground">
          The 5-digit number from the ASU catalog &quot;Class #&quot; column.
        </p>
      </div>

      <Button
        type="submit"
        variant="gradient"
        disabled={isSubmitting || !term || !classNbr || selectableTerms.length === 0}
        className="w-full"
      >
        {isSubmitting ? submittingLabel : submitLabel}
      </Button>
    </form>
  );
}
