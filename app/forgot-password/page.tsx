'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSignIn } from '@clerk/clerk-react';
import { log } from '@/lib/log';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signIn, isLoaded } = useSignIn();

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!email) {
      setError('Email is required');
      setLoading(false);
      return;
    }

    if (!isLoaded || !signIn) {
      setError('Authentication not ready — please try again');
      setLoading(false);
      return;
    }

    try {
      // Clerk reset flow: create a sign-in attempt that triggers the email code.
      await signIn.create({
        strategy: 'reset_password_email_code',
        identifier: email,
      });
      setSuccess(true);
    } catch (err) {
      // Clerk errors carry a ClerkAPIResponseError shape with errors[].longMessage,
      // but we avoid chained assertions by falling back to the generic message.
      const msg = err instanceof Error ? err.message : null;
      setError(msg ?? 'An unexpected error occurred');
      log('ForgotPassword').error('Password-reset request failed:', err);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl">Check your email</CardTitle>
            <CardDescription>We&apos;ve sent you a password reset link</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Alert className="bg-success/10 text-success border-success/30">
              <AlertDescription>
                A password reset link has been sent to <strong>{email}</strong>. Please check your
                inbox and follow the instructions to reset your password.
              </AlertDescription>
            </Alert>

            <div className="text-center">
              <Link href="/login">
                <Button variant="link" className="p-0">
                  Back to sign in
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">Forgot Your Password?</CardTitle>
          <CardDescription>
            No worries. Enter your email and we'll send you a reset link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleResetPassword} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Sending reset link...' : 'Send reset link'}
            </Button>

            <div className="text-center">
              <Link href="/login">
                <Button variant="link" className="p-0">
                  Back to sign in
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
