'use client';

import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Header } from '@/components/Header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { safeInternalPath } from '@/lib/auth/safe-redirect';

function ConsentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ageVerified, setAgeVerified] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get('error') === 'save_failed'
      ? 'We could not save your confirmation. Please try again.'
      : null
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ageVerified || !agreedToTerms) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ageVerified, agreedToTerms }),
      });
      // SAFETY: /api/auth/consent returns JSON with optional error string; shape asserted from API contract validated by server
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error || 'Could not save consent');
        return;
      }

      router.replace(safeInternalPath(searchParams.get('next'), '/dashboard'));
    } catch {
      setError('Could not save consent');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background relative">
      <div className="absolute inset-0 bg-grid-pattern mask-[linear-gradient(to_bottom,white,transparent)] pointer-events-none" />
      <Header />
      <main
        id="main"
        tabIndex={-1}
        className="relative z-10 flex flex-1 items-center justify-center p-4"
      >
        <Card className="w-full max-w-md overflow-hidden">
          <div className="h-1.5 bg-accent" />
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-accent/20 text-primary">
              <ShieldCheck className="size-6" aria-hidden="true" />
            </div>
            <CardTitle className="text-3xl">Confirm your account</CardTitle>
            <CardDescription>One final step before you start tracking ASU classes.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                <div className="flex items-start gap-3">
                  <input
                    id="ageVerified"
                    type="checkbox"
                    checked={ageVerified}
                    onChange={(event) => setAgeVerified(event.target.checked)}
                    disabled={saving}
                    className="mt-1 size-4 rounded border-input"
                    required
                  />
                  <Label htmlFor="ageVerified" className="cursor-pointer font-normal leading-5">
                    I am 18 years or older and a resident of the United States
                  </Label>
                </div>
                <div className="flex items-start gap-3">
                  <input
                    id="agreedToTerms"
                    type="checkbox"
                    checked={agreedToTerms}
                    onChange={(event) => setAgreedToTerms(event.target.checked)}
                    disabled={saving}
                    className="mt-1 size-4 rounded border-input"
                    required
                  />
                  <Label htmlFor="agreedToTerms" className="cursor-pointer font-normal leading-5">
                    I agree to the{' '}
                    <Link
                      href="/legal/terms"
                      className="text-primary underline-offset-4 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Terms of Service
                    </Link>{' '}
                    and{' '}
                    <Link
                      href="/legal/privacy"
                      className="text-primary underline-offset-4 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Privacy Policy
                    </Link>
                  </Label>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={!ageVerified || !agreedToTerms || saving}
              >
                {saving ? 'Saving...' : 'Save and continue'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

export default function ConsentPage() {
  return (
    <Suspense fallback={null}>
      <ConsentForm />
    </Suspense>
  );
}
