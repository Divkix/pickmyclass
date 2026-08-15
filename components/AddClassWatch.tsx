'use client';

import { Lightbulb, Lock } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TermSelect } from '@/components/TermSelect';
import { useClassWatchForm } from '@/lib/class-watches/useClassWatchForm';
import type { ClassWatchCreationInput } from '@/lib/class-watches/class-watch-creation';
import type { ClassWatchRow } from '@/lib/types/class-watch';

interface AddClassWatchProps {
  onCreated: (watch: ClassWatchRow, input: ClassWatchCreationInput) => void | Promise<void>;
}

export function AddClassWatch({ onCreated }: AddClassWatchProps) {
  const [university] = useState('asu');

  const { terms, term, setTerm, classNbr, setClassNbr, error, isSubmitting, handleSubmit } =
    useClassWatchForm({
      onCreated,
      resetOnSuccess: true,
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start Watching a Class</CardTitle>
        <CardDescription>
          Once you add a class, we'll check it every 30 minutes and email you when seats open.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert className="bg-destructive/10 text-destructive border-destructive/30">
              {error}
            </Alert>
          )}

          {/* University Dropdown (Disabled) */}
          <div className="space-y-2">
            <Label htmlFor="university">University *</Label>
            <div className="relative">
              <Select value={university} disabled>
                <SelectTrigger id="university">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asu">Arizona State University (ASU)</SelectItem>
                </SelectContent>
              </Select>
              <Lock className="absolute right-9 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            </div>
            <p className="text-xs text-muted-foreground">More universities coming soon</p>
          </div>

          <TermSelect value={term} onValueChange={setTerm} terms={terms} id="term" />

          {/* Section Number */}
          <div className="space-y-2">
            <Label htmlFor="section_number">Section Number *</Label>
            <Input
              id="section_number"
              placeholder="19439"
              value={classNbr}
              onChange={(e) => setClassNbr(e.target.value)}
              required
              maxLength={5}
              pattern="\d{5}"
              title="Must be a 5-digit section number"
            />
            <div className="flex gap-2.5 rounded-md bg-primary/5 border border-primary/20 p-3 text-sm">
              <Lightbulb className="size-4 shrink-0 text-primary mt-0.5" aria-hidden="true" />
              <p className="text-foreground">
                <strong>How to find this:</strong> Go to the{' '}
                <a
                  href="https://catalog.apps.asu.edu/catalog/classes/classlist"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary underline hover:text-primary/80"
                >
                  ASU Class Search page
                </a>
                , search for your class, and look for the 5-digit number in the &quot;Class #&quot;
                column.
              </p>
            </div>
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            variant="gradient"
            disabled={isSubmitting || !term || !classNbr || terms.length === 0}
            className="w-full"
          >
            {isSubmitting ? "Checking ASU's class search... hang tight" : 'Start Watching'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
