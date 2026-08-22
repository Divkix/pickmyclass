'use client';

import { useUser, useClerk } from '@clerk/clerk-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { log } from '@/lib/log';

export default function VerifyEmailPage() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { user } = useUser();
  const { signOut } = useClerk();

  const userEmail = user?.primaryEmailAddress?.emailAddress ?? '';
  const isVerified = user?.primaryEmailAddress?.verification.status === 'verified';

  useEffect(() => {
    if (isVerified) {
      // Already verified at Clerk — sync mirror and leave.
      void fetch('/api/auth/email-verified', { method: 'POST' }).finally(() => {
        router.push('/dashboard');
      });
    }
  }, [isVerified, router]);

  const handleVerifyCode = async () => {
    if (!code.trim()) {
      setError('Please enter the verification code');
      return;
    }
    if (!user?.primaryEmailAddress) {
      setError('No email found. Please sign in again.');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const attempt = await user.primaryEmailAddress.attemptVerification({ code: code.trim() });
      // Clerk marks the address verified on success; sync the local mirror so the
      // edge gate stops bouncing to /verify-email (30s cache + webhook latency).
      if (attempt.verification.status === 'verified') {
        try {
          await fetch('/api/auth/email-verified', { method: 'POST' });
        } catch {
          // Non-blocking — webhook will eventually sync.
        }
        setSuccess('Email verified! Redirecting…');
        setTimeout(() => router.push('/dashboard'), 800);
      } else {
        setError('Verification incomplete — please try again');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : null;
      setError(msg ?? 'Failed to verify code');
      log('VerifyEmail').error('Code verification failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSendVerificationAgain = async () => {
    if (!user?.primaryEmailAddress) {
      setError('No email found. Please sign in again.');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await user.primaryEmailAddress.prepareVerification({ strategy: 'email_code' });
      setSuccess('Verification code sent! Please check your inbox.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : null;
      setError(msg ?? 'Failed to send verification email again');
      log('VerifyEmail').error('Verification resend failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      await fetch('/api/auth/signout', { method: 'POST' });
    } catch {
      // Best-effort
    }
    router.push('/login');
  };

  const handleAlreadyVerified = async () => {
    // User clicked the email link (which verifies at Clerk) but the mirror hasn't
    // synced yet — force a sync and then redirect.
    setLoading(true);
    try {
      const res = await fetch('/api/auth/email-verified', { method: 'POST' });
      if (res.ok) {
        router.push('/dashboard');
        return;
      }
      setError('Email is not verified yet — please check your inbox');
    } catch (err) {
      log('VerifyEmail').error('Forced sync failed:', err);
      setError('Could not confirm verification');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl">Verify Your Email</CardTitle>
            <CardDescription>
              Almost there! Check your inbox to start watching classes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-4 text-sm text-blue-800 dark:text-blue-300">
              <p className="font-medium mb-2">We sent a verification email to:</p>
              <p className="font-mono text-xs break-all">{userEmail || 'your email address'}</p>
              <p className="mt-4">
                Click the link in the email to verify your account and start monitoring classes.
              </p>
            </div>

            {success && (
              <Alert className="bg-success/10 text-success border-success/30">
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            {isVerified && (
              <Alert className="bg-success/10 text-success border-success/30">
                <AlertDescription>Your email is verified! Syncing your account…</AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <Button
                onClick={handleVerifyCode}
                disabled={loading || !code.trim()}
                className="w-full"
              >
                {loading ? 'Verifying…' : 'Verify code'}
              </Button>
              <Button
                onClick={handleSendVerificationAgain}
                disabled={loading}
                variant="outline"
                className="w-full"
              >
                {loading ? 'Sending...' : 'Send code again'}
              </Button>
              <Button
                onClick={handleAlreadyVerified}
                disabled={loading}
                variant="secondary"
                className="w-full"
              >
                I&apos;ve clicked the email link — continue
              </Button>
              <Button onClick={handleSignOut} variant="ghost" className="w-full">
                Sign Out
              </Button>
            </div>

            <div className="text-center text-sm text-muted-foreground">
              <p>
                Didn&apos;t receive the email? Check your spam folder or click the button above to
                send it again.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
