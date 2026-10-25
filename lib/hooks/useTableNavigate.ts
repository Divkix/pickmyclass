"use client";

import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

/**
 * Writes admin-table filters into the URL, dropping empty and "all" values so
 * the default view stays bookmarkable. Returns a stable navigate callback.
 */
export function useTableNavigate(): (updates: Record<string, string>) => void {
  const navigate = useNavigate();
  const { pathname, searchStr } = useLocation();

  return useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchStr);

      for (const [key, value] of Object.entries(updates)) {
        if (value === "" || value === "all") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }

      const query = params.toString();
      void navigate({ href: query ? `${pathname}?${query}` : pathname });
    },
    [navigate, pathname, searchStr],
  );
}
