'use client';

import { useAuth as useClerkAuth, useClerk, useUser } from '@clerk/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import {
  identifyAnalyticsUser,
  resetAnalyticsIdentity,
  trackAnalyticsEvent,
} from '@/lib/analytics/client';
import { log } from '@/lib/log';

interface CompatUser {
  id: string;
  email: string | null;
  email_confirmed_at: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
}

interface CompatSession {
  id: string;
}

interface AuthContextType {
  user: CompatUser | null;
  session: CompatSession | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded: userLoaded, user: clerkUser } = useUser();
  const { isLoaded: authLoaded, sessionId } = useClerkAuth();
  const clerk = useClerk();

  const loading = !userLoaded || !authLoaded;

  const compatUser: CompatUser | null = useMemo(
    () =>
      clerkUser
        ? {
            id: clerkUser.id,
            email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
            email_confirmed_at:
              clerkUser.primaryEmailAddress?.verification.status === 'verified'
                ? (clerkUser.createdAt?.toISOString() ?? new Date().toISOString())
                : null,
            created_at: clerkUser.createdAt?.toISOString(),
            last_sign_in_at: clerkUser.lastSignInAt?.toISOString() ?? null,
          }
        : null,
    [clerkUser]
  );

  const compatSession: CompatSession | null = useMemo(
    () => (sessionId ? { id: sessionId } : null),
    [sessionId]
  );

  const analyticsUserId = clerkUser ? (clerkUser.externalId ?? clerkUser.id) : null;
  const analyticsEmail = clerkUser?.primaryEmailAddress?.emailAddress ?? null;
  // Reset only on a signed-in → signed-out transition, so sessions that end
  // outside signOut() (expiry, sign-out in another tab) stop attributing events
  // to the previous user. Resetting on every anonymous load would mint a new
  // anonymous distinct id per page view and split one visitor into many.
  const wasIdentified = useRef(false);
  useEffect(() => {
    if (analyticsUserId) {
      identifyAnalyticsUser(analyticsUserId, { email: analyticsEmail });
      wasIdentified.current = true;
    } else if (!loading && wasIdentified.current) {
      resetAnalyticsIdentity();
      wasIdentified.current = false;
    }
  }, [analyticsUserId, analyticsEmail, loading]);

  const signOut = useCallback(async () => {
    try {
      trackAnalyticsEvent('user_logged_out', {});
      resetAnalyticsIdentity();
      wasIdentified.current = false;
      await clerk.signOut();
      await fetch('/api/auth/signout', { method: 'POST' });
    } catch (error) {
      log('AuthContext').error('Sign-out failed:', error);
      throw error;
    }
  }, [clerk]);

  const value = useMemo(
    () => ({ user: compatUser, session: compatSession, loading, signOut }),
    [compatUser, compatSession, loading, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}
