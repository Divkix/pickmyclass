'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { useAuth } from '@/lib/contexts/AuthContext';

export function AuthRedirect({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !loading && user?.email_confirmed_at) {
      router.replace('/dashboard');
    }
  }, [user, loading, router, mounted]);

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
