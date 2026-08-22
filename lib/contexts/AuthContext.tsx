'use client';

import { useAuth as useClerkAuth, useClerk, useUser } from '@clerk/clerk-react';
import posthog from 'posthog-js';
import { createContext, useContext, useEffect, useState } from 'react';
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
  isAdmin: boolean;
  checkingAdmin: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded: userLoaded, user: clerkUser } = useUser();
  const { isLoaded: authLoaded, sessionId } = useClerkAuth();
  const clerk = useClerk();

  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);

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

  // isAdmin is a UI affordance only (never a security boundary — server
  // verifyAdmin + proxy decideGate are authoritative). Check via a lightweight
  // fetch to an auth-gated endpoint; fail open to false.
  useEffect(() => {
    let cancelled = false;
    if (!compatUser?.id) {
      setIsAdmin(false);
      setCheckingAdmin(false);
      return;
    }
    const ctrl = new AbortController();
    async function checkAdmin() {
      setCheckingAdmin(true);
      try {
        const res = await fetch('/api/user/onboarding', {
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
        });
        if (cancelled || ctrl.signal.aborted) return;
        if (!res.ok) {
          setIsAdmin(false);
          return;
        }
        setIsAdmin(false);
      } catch (error) {
        if (cancelled || ctrl.signal.aborted) return;
        log('AuthContext').error('Admin-status lookup failed:', error);
        setIsAdmin(false);
      } finally {
        if (!cancelled) setCheckingAdmin(false);
      }
    }
    void checkAdmin();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [compatUser?.id]);

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
    <AuthContext.Provider
      value={{
        user: compatUser,
        session: compatSession,
        loading,
        isAdmin,
        checkingAdmin,
        signOut,
      }}
    >
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
