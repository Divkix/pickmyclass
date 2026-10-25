"use client";

import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/contexts/AuthContext";

export function useRedirectIfAuthenticated(redirectTo = "/dashboard") {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user?.email_confirmed_at) {
      void navigate({ href: redirectTo, replace: true });
    }
  }, [user, loading, navigate, redirectTo]);
}
