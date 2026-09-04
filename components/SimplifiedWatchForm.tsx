'use client';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TermSelect } from '@/components/TermSelect';
import { useClassWatchForm } from '@/lib/class-watches/useClassWatchForm';
import type { ClassWatchCreationInput } from '@/lib/class-watches/class-watch-creation';
import type { ClassWatchRow } from '@/lib/types/class-watch';

interface SimplifiedWatchFormProps {
  onCreated: (watch: ClassWatchRow, input: ClassWatchCreationInput) => void | Promise<void>;
  onSubmittingChange?: (submitting: boolean) => void;
  defaultClassNbr?: string;
  submitLabel?: string;
  submittingLabel?: string;
}

export function SimplifiedWatchForm({
  onCreated,
  onSubmittingChange,
  defaultClassNbr = '',
  submitLabel = 'Start Watching',
  submittingLabel = "Checking ASU's class search... hang tight",
}: SimplifiedWatchFormProps) {
  const { terms, term, setTerm, classNbr, setClassNbr, error, isSubmitting, handleSubmit } =
    useClassWatchForm({
      defaultClassNbr,
      onCreated,
      onSubmittingChange,
    });

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <Alert className="bg-destructive/10 text-destructive border-destructive/30">{error}</Alert>
      )}

      <TermSelect value={term} onValueChange={setTerm} terms={terms} id="onboarding-term" />

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
        disabled={isSubmitting || !term || !classNbr || terms.length === 0}
        className="w-full"
      >
        {isSubmitting ? submittingLabel : submitLabel}
      </Button>
    </form>
  );
}
