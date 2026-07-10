'use client';

import type { Session, User } from '@supabase/supabase-js';
import posthog from 'posthog-js';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  checkingAdmin: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    // Get initial session - use getUser() to sync with server-set HTTP-only cookies
    const initializeAuth = async () => {
      try {
        // getUser() makes an authenticated request that includes HTTP-only cookies,
        // allowing the server to validate the session even when login was server-side
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (error || !user) {
          setUser(null);
          setSession(null);
          return;
        }

        // After getUser() validates, getSession() returns the synced session
        const {
          data: { session },
        } = await supabase.auth.getSession();
        setSession(session);
        setUser(user);
        posthog.identify(user.id, { email: user.email });
      } catch (error) {
        console.error('Error getting session:', error);
      } finally {
        setLoading(false);
      }
    };

    void initializeAuth();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, currentSession) => {
      if (_event === 'SIGNED_IN' && currentSession?.user) {
        posthog.identify(currentSession.user.id, { email: currentSession.user.email });
        posthog.capture('user_logged_in');
      }
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase.auth]);

  // Key on user id (not the user object) so token refreshes, which produce a new
  // user reference with the same id, don't trigger a redundant admin re-query.
  const userId = user?.id;

  useEffect(() => {
    let cancelled = false;

    async function checkAdminStatus() {
      if (!userId) {
        setIsAdmin(false);
        setCheckingAdmin(false);
        return;
      }

      setCheckingAdmin(true);
      try {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('is_admin')
          .eq('user_id', userId)
          .maybeSingle();

        if (cancelled) return;
        setIsAdmin(profile?.is_admin ?? false);
      } catch (error) {
        if (cancelled) return;
        console.error('Error checking admin status:', error);
        setIsAdmin(false);
      } finally {
        if (!cancelled) setCheckingAdmin(false);
      }
    }

    void checkAdminStatus();

    return () => {
      cancelled = true;
    };
  }, [userId, supabase]);

  const signOut = async () => {
    try {
      posthog.capture('user_logged_out');
      posthog.reset();
      await fetch('/api/auth/signout', { method: 'POST' });
      setUser(null);
      setSession(null);
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, isAdmin, checkingAdmin, signOut }}>
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
