"use client";

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/contexts/AuthContext";
import { errorFields, log } from "@/lib/log";

export function AuthButton() {
  const { user, loading, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    try {
      setSigningOut(true);
      await signOut();
    } catch (error) {
      log("AuthButton").error("Sign-out failed", errorFields(error));
    } finally {
      window.location.href = "/sign-in";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 sm:gap-4">
        <Skeleton className="h-10 w-24" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2 sm:gap-4">
        <Button asChild variant="ghost" className="min-h-11">
          <Link to="/sign-in">Sign in</Link>
        </Button>
        <Button asChild className="min-h-11">
          <Link to="/sign-up">Sign up</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 sm:gap-4">
      <div className="flex items-center gap-2">
        <span
          className="hidden truncate text-sm text-muted-foreground xs:inline-block xs:max-w-[120px] sm:max-w-[180px]"
          title={user.email ?? undefined}
        >
          {user.email}
        </span>
      </div>
      <Button onClick={handleSignOut} disabled={signingOut} variant="outline" className="min-h-11">
        {signingOut ? "Signing out..." : "Sign out"}
      </Button>
    </div>
  );
}
