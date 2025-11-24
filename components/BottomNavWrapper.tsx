'use client';

import { useAuth } from '@/lib/contexts/AuthContext';
import { BottomNav } from '@/components/BottomNav';

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
