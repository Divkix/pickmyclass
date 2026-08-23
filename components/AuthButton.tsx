'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/contexts/AuthContext';
import { log } from '@/lib/log';

export function AuthButton() {
  const { user, loading, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    try {
      setSigningOut(true);
      await signOut();
    } catch (error) {
      log('AuthButton').error('Sign-out failed:', error);
    } finally {
      // Fallback: force navigation to /sign-in even if sign-out failed
      window.location.href = '/sign-in';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 sm:gap-4">
        <Skeleton className="h-10 w-24" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2 sm:gap-4">
        <Link href="/sign-in">
          <Button variant="ghost" className="min-h-11">
            Sign in
          </Button>
        </Link>
        <Link href="/sign-up">
          <Button className="min-h-11">Sign up</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 sm:gap-4">
      <div className="flex items-center gap-2">
        <span
          className="hidden truncate text-sm text-muted-foreground xs:inline-block xs:max-w-[120px] sm:max-w-[180px]"
          title={user.email ?? undefined}
        >
          {user.email}
        </span>
      </div>
      <Button onClick={handleSignOut} disabled={signingOut} variant="outline" className="min-h-11">
        {signingOut ? 'Signing out...' : 'Sign out'}
      </Button>
    </div>
  );
}
