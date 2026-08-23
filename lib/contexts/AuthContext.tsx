'use client';

import { useAuth as useClerkAuth, useClerk, useUser } from '@clerk/react';
import posthog from 'posthog-js';
import { createContext, useContext, useEffect } from 'react';
import { log } from '@/lib/log';

// Keep the legacy shape that existing consumers expect, but without Supabase types.
// `user` is a minimal compat object (id + email + email_confirmed_at) and `session`
// is the Clerk session id wrapper — sufficient for Header/AuthButton/dashboard guards.
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

  const compatUser: CompatUser | null = clerkUser
    ? {
        id: clerkUser.id,
        email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
        // Clerk verification status → legacy email_confirmed_at gate.
        email_confirmed_at:
          clerkUser.primaryEmailAddress?.verification.status === 'verified'
            ? (clerkUser.createdAt?.toISOString() ?? new Date().toISOString())
            : null,
        created_at: clerkUser.createdAt?.toISOString(),
        last_sign_in_at: clerkUser.lastSignInAt?.toISOString() ?? null,
      }
    : null;

  const compatSession: CompatSession | null = sessionId ? { id: sessionId } : null;

  // PostHog identify — mirrors the old Supabase flow.
  useEffect(() => {
    if (compatUser) {
      posthog.identify(compatUser.id, { email: compatUser.email ?? undefined });
    }
  }, [compatUser?.id, compatUser?.email]);

  const signOut = async () => {
    try {
      posthog.capture('user_logged_out');
      posthog.reset();
      await clerk.signOut();
      await fetch('/api/auth/signout', { method: 'POST' });
    } catch (error) {
      log('AuthContext').error('Sign-out failed:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user: compatUser, session: compatSession, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
