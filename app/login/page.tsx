'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/contexts/AuthContext';
import { log } from '@/lib/log';
import { createClient } from '@/lib/supabase/client';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  // Redirect already-authenticated users away from the login page.
  useEffect(() => {
    if (!authLoading && user?.email_confirmed_at) {
      router.replace('/dashboard');
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    // Check if user just registered
    if (searchParams.get('registered') === 'true') {
      setSuccess('Account created successfully! Please check your email to verify your account.');
    }
    // Check if password was reset
    if (searchParams.get('password_reset') === 'true') {
      setSuccess('Password reset successfully! Please sign in with your new password.');
    }
    // Check if account was deleted
    if (searchParams.get('message')) {
      setSuccess(searchParams.get('message')!);
    }
    // Check if account was disabled
    if (searchParams.get('error') === 'account_disabled') {
      setError(
        'Your account has been disabled. If you believe this is an error, please contact support.'
      );
    }
    // Check if OAuth failed
    if (searchParams.get('error') === 'oauth_failed') {
      setError('Failed to sign in with Google. Please try again.');
    }
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    // CRITICAL: Prevent form submission FIRST, before any other code
    e.preventDefault();
    e.stopPropagation();

    setError(null);
    setSuccess(null);
    setLoading(true);

    // Validation
    if (!email || !password) {
      setError('Email and password are required');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      type LoginResponse = {
        success?: boolean;
        error?: string;
        details?: {
          isLocked?: boolean;
          remainingMinutes?: number;
          remainingAttempts?: number;
        };
      };

      const data: LoginResponse = await response.json();

      if (!response.ok) {
        const details = data.details;
        if (response.status === 423 && details?.remainingMinutes) {
          const minutes = details.remainingMinutes || 15;
          setError(
            `Account locked due to too many failed login attempts. Please try again in ${minutes} minute${minutes !== 1 ? 's' : ''}.`
          );
        } else if (
          typeof details?.remainingAttempts === 'number' &&
          details.remainingAttempts > 0 &&
          details.remainingAttempts <= 3
        ) {
          setError(
            `${data.error || 'Invalid email or password'} (${details.remainingAttempts} attempt${details.remainingAttempts !== 1 ? 's' : ''} remaining)`
          );
        } else {
          setError(data.error || 'Failed to sign in');
        }
        setLoading(false);
        return;
      }

      window.location.href = '/';
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
      log('Login').error('Password login failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setError(null);
      setSuccess(null);
      setGoogleLoading(true);
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
        },
      });

      if (error) {
        setError(error.message);
        setGoogleLoading(false);
      }
      // Note: we don't reset loading on success because browser will navigate away
    } catch (err) {
      setError('Failed to initiate Google sign-in');
      log('Login').error('Google login failed:', err);
      setGoogleLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background relative">
      <div className="absolute inset-0 bg-grid-pattern mask-[linear-gradient(to_bottom,white,transparent)] pointer-events-none" />
      <Header />
      <div className="flex flex-1 items-center justify-center p-4 relative z-10">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Badge className="bg-asu-maroon text-white mb-2">For Sun Devils</Badge>
            <CardTitle className="text-3xl">Welcome Back</CardTitle>
            <CardDescription>
              Sign in to check on your classes. We've been watching them for you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-6" noValidate>
              <div className="space-y-4">
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

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link
                      href="/forgot-password"
                      className="text-sm font-medium text-foreground hover:text-muted-foreground"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
              </div>

              {success && (
                <Alert className="bg-success/10 text-success border-success/30" role="status">
                  <AlertDescription>{success}</AlertDescription>
                </Alert>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" disabled={loading || googleLoading} className="w-full">
                {loading ? 'Signing in...' : 'Sign in'}
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={handleGoogleSignIn}
                disabled={googleLoading || loading}
                className="w-full"
              >
                <svg className="mr-2 size-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                {googleLoading ? 'Redirecting to Google...' : 'Sign in with Google'}
              </Button>

              <div className="text-center text-sm">
                <span className="text-muted-foreground">Don&apos;t have an account? </span>
                <Link
                  href="/register"
                  className="font-medium text-foreground hover:text-muted-foreground"
                >
                  Sign up
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col bg-background">
          <Header />
          <div className="flex flex-1 items-center justify-center p-4">
            <Card className="w-full max-w-md">
              <CardHeader className="text-center">
                <CardTitle className="text-3xl">Loading...</CardTitle>
              </CardHeader>
            </Card>
          </div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
