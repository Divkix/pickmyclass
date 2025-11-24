'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function AuthButton() {
  const { user, loading, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      setSigningOut(true);
      await signOut();
      router.push('/login');
    } catch (error) {
      console.error('Error signing out:', error);
    } finally {
      setSigningOut(false);
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
        <Link href="/login">
          <Button variant="ghost" className="min-h-11">
            Sign in
          </Button>
        </Link>
        <Link href="/register">
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
