'use client';

import { useMemo, useState } from 'react';
import { formatTermOption, getSelectableTerms } from '@/lib/asu/terms';
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

interface SimplifiedWatchFormProps {
  /** Performs the watch-creation request; should throw on failure. */
  onSubmit: (data: { term: string; class_nbr: string }) => Promise<void>;
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
  onSubmit,
  defaultClassNbr = '',
  submitLabel = 'Start Watching',
  submittingLabel = "Checking ASU's class search... hang tight",
}: SimplifiedWatchFormProps) {
  const selectableTerms = useMemo(() => getSelectableTerms(), []);
  const defaultTerm = selectableTerms[0]?.code ?? '';

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState(defaultTerm);
  const [classNbr, setClassNbr] = useState(defaultClassNbr);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!term || !classNbr) {
      setError('Please select a term and enter a class number');
      return;
    }

    if (classNbr.length !== 5 || !/^\d{5}$/.test(classNbr)) {
      setError('Class number must be exactly 5 digits');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({ term, class_nbr: classNbr });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add class watch');
    } finally {
      setIsSubmitting(false);
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
