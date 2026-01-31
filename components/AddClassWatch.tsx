'use client';

import { Lock } from 'lucide-react';
import { useState } from 'react';
import { Alert } from './ui/alert';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface AddClassWatchProps {
  onAdd: (watch: { term: string; class_nbr: string }) => Promise<void>;
}

export function AddClassWatch({ onAdd }: AddClassWatchProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [university] = useState('asu');
  const [term, setTerm] = useState('');
  const [classNbr, setClassNbr] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!term || !classNbr) {
      setError('Please select a term and enter a section number');
      return;
    }

    if (classNbr.length !== 5 || !/^\d{5}$/.test(classNbr)) {
      setError('Section number must be exactly 5 digits');
      return;
    }

    setIsSubmitting(true);

    try {
      await onAdd({
        term,
        class_nbr: classNbr,
      });
      // Reset form on success
      setTerm('');
      setClassNbr('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add class watch');
    } finally {
      setIsSubmitting(false);
    }
  };

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
              <Lock className="absolute right-9 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
            <p className="text-xs text-muted-foreground">More universities coming soon</p>
          </div>

          {/* Term Dropdown */}
          <div className="space-y-2">
            <Label htmlFor="term">Term *</Label>
            <Select value={term} onValueChange={setTerm} required>
              <SelectTrigger id="term">
                <SelectValue placeholder="Select term" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2261">Spring 2026 (2261)</SelectItem>
                <SelectItem value="2264">Summer 2026 (2264)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Select the term to monitor</p>
          </div>

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
            <div className="rounded-md bg-info/10 border border-info/30 p-3 text-sm">
              <p className="text-primary">
                💡 <strong>How to find this:</strong> Go to the{' '}
                <a
                  href="https://catalog.apps.asu.edu/catalog/classes/classlist"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-primary/80"
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
            disabled={isSubmitting || !term || !classNbr}
            className="w-full"
          >
            {isSubmitting ? "Checking ASU's class search... hang tight" : 'Start Watching'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
