'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Header } from '@/components/Header';
import { useAuth } from '@/lib/contexts/AuthContext';

export function AuthRedirect({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { replace } = useRouter();

  useEffect(() => {
    if (!loading && user?.email_confirmed_at) {
      replace('/dashboard');
    }
  }, [user, loading, replace]);

  // Show spinner while checking auth or if authenticated (redirect pending)
  if (loading || user?.email_confirmed_at) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
        <div className="flex flex-1 items-center justify-center">
          <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
