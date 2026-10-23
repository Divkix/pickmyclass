"use client";

import { useAuth as useClerkAuth, useClerk, useUser } from "@clerk/react";
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { errorFields, log } from "@/lib/log";
import { setTelemetryUser, trackBrowserAction } from "@/lib/telemetry/browser";
import { claimLoginSession } from "@/lib/telemetry/login-session";

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
              clerkUser.primaryEmailAddress?.verification.status === "verified"
                ? (clerkUser.createdAt?.toISOString() ?? new Date().toISOString())
                : null,
            created_at: clerkUser.createdAt?.toISOString(),
            last_sign_in_at: clerkUser.lastSignInAt?.toISOString() ?? null,
          }
        : null,
    [clerkUser],
  );

  const compatSession: CompatSession | null = useMemo(
    () => (sessionId ? { id: sessionId } : null),
    [sessionId],
  );

  const telemetryUserId = clerkUser?.id ?? null;

  // Follows the Clerk session wherever it ends (signOut, expiry, another tab).
  useEffect(() => {
    if (!loading) setTelemetryUser(telemetryUserId);
  }, [telemetryUserId, loading]);

  useEffect(() => {
    if (telemetryUserId && sessionId && claimLoginSession(() => window.localStorage, sessionId)) {
      trackBrowserAction("user_logged_in", {});
    }
  }, [telemetryUserId, sessionId]);

  const signOut = useCallback(async () => {
    try {
      await clerk.signOut();
      trackBrowserAction("user_logged_out", {});
      await fetch("/api/auth/signout", { method: "POST" });
    } catch (error) {
      log("AuthContext").error("Sign-out failed", errorFields(error));
      throw error;
    }
  }, [clerk]);

  const value = useMemo(
    () => ({ user: compatUser, session: compatSession, loading, signOut }),
    [compatUser, compatSession, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
