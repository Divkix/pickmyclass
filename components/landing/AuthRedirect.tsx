'use client';

import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useRedirectIfAuthenticated } from '@/lib/hooks/useRedirectIfAuthenticated';

export function AuthRedirect({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  useRedirectIfAuthenticated();

  // During SSR and before hydration, always render full content (for crawlers)
  if (!mounted) {
    return <>{children}</>;
  }

  // After hydration, show spinner while checking auth or if authenticated (redirect pending)
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
