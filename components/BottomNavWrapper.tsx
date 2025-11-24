'use client';

import { BottomNav } from '@/components/BottomNav';
import { useAuth } from '@/lib/contexts/AuthContext';

/**
 * Wrapper component that conditionally renders BottomNav
 * based on authentication status and current route
 */
export function BottomNavWrapper() {
  const { user, loading } = useAuth();

  // Don't render while checking auth
  if (loading) {
    return null;
  }

  // Only show for authenticated users
  if (!user) {
    return null;
  }

  return <BottomNav />;
}
