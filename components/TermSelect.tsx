'use client';

import { formatTermOption } from '@/lib/asu/terms';
import type { AsuTerm } from '@/lib/asu/terms';
import { Alert } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface TermSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  terms: AsuTerm[];
  id?: string;
}

export function TermSelect({ value, onValueChange, terms, id = 'term' }: TermSelectProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Term *</Label>
      {terms.length === 0 ? (
        <Alert className="bg-destructive/10 text-destructive border-destructive/30">
          No terms are currently available. Please check back later or contact support.
        </Alert>
      ) : (
        <Select value={value} onValueChange={onValueChange} required>
          <SelectTrigger id={id}>
            <SelectValue placeholder="Select term" />
          </SelectTrigger>
          <SelectContent>
            {terms.map((termOption) => (
              <SelectItem key={termOption.code} value={termOption.code}>
                {formatTermOption(termOption)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <p className="text-xs text-muted-foreground">Select the term to monitor</p>
    </div>
  );
}
