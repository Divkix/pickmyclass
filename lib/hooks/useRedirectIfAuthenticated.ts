'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';

export function useRedirectIfAuthenticated(redirectTo = '/dashboard') {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user?.email_confirmed_at) {
      router.replace(redirectTo);
    }
  }, [user, loading, router, redirectTo]);
}
