import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Watchlist, WatchWithState } from "@/lib/class-watches/watchlist";
import { useAuth } from "@/lib/contexts/AuthContext";
import { usePullToRefresh } from "@/lib/hooks/usePullToRefresh";
import { useRealtimeClassStates } from "@/lib/hooks/useRealtimeClassStates";
import { completeOnFirstWatch, type OnboardingState } from "@/lib/onboarding";
import { sectionRefKey } from "@/lib/section-ref";
import type { ClassStateRow, ClassWatchRow } from "@/lib/types/class-watch";

export interface ClassWatchStats {
  totalWatches: number;
  availableSeats: number;
  fullClasses: number;
}

async function requestWatches(): Promise<Watchlist> {
  const response = await fetch("/api/class-watches");

  if (!response.ok) {
    throw new Error("Failed to fetch class watches");
  }

  // SAFETY: /api/class-watches returns JSON shaped as Watchlist per API contract
  return (await response.json()) as Watchlist;
}

/**
 * Dashboard state seeded from the server-rendered `initial` watchlist, so the first view
 * needs no fetch. It refetches on pull-to-refresh, after restore, and when the Clerk user
 * stops matching the one the server rendered for. Every change to the watchlist or
 * onboarding invalidates loaders, so Back never remounts from stale cached loader data.
 */
export function useClassWatches(initial: Watchlist, ownerClerkUserId: string) {
  const router = useRouter();
  const { user } = useAuth();
  const [watches, setWatches] = useState<WatchWithState[]>(initial.watches);
  const [maxWatches, setMaxWatches] = useState(initial.maxWatches);
  const [isLoadingWatches, setIsLoadingWatches] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [onboarding, setOnboarding] = useState<OnboardingState>(initial.onboarding);
  const [ownerId, setOwnerId] = useState(ownerClerkUserId);
  const [ownerChanges, setOwnerChanges] = useState(0);

  if (user && user.id !== ownerId) {
    setOwnerId(user.id);
    setOwnerChanges((count) => count + 1);
    setIsLoadingWatches(true);
    setError(null);
  }

  const classNumbers = useMemo(() => watches.map((w) => w.class_nbr), [watches]);

  // /api/class-watches already returns each watch's state, so the realtime hook
  // can seed from it instead of firing an immediate /class-watches/states request.
  const seedStates = useMemo(() => {
    const seeds: Record<string, ClassStateRow> = {};

    for (const watch of watches) {
      if (watch.class_state) {
        seeds[sectionRefKey(watch)] = watch.class_state;
      }
    }

    return seeds;
  }, [watches]);

  const {
    classStates,
    loading: realtimeLoading,
    error: realtimeError,
    refetch: refetchClassStates,
  } = useRealtimeClassStates({
    classNumbers,
    enabled: classNumbers.length > 0,
    seedStates,
  });

  const loadWatches = useCallback(
    () =>
      requestWatches()
        .then(
          (data) => {
            setWatches(data.watches);
            setMaxWatches(data.maxWatches);
            setOnboarding(data.onboarding);
            void router.invalidate();

            return data;
          },
          (err: Error | string) => {
            const errorMessage =
              err instanceof Error ? err.message : "Failed to load class watches";

            setError(errorMessage);

            throw new Error(errorMessage);
          },
        )
        .finally(() => setIsLoadingWatches(false)),
    [router],
  );

  const fetchWatches = useCallback(async (): Promise<Watchlist> => {
    setIsLoadingWatches(true);
    setError(null);

    return loadWatches();
  }, [loadWatches]);

  useEffect(() => {
    if (ownerChanges > 0) {
      void loadWatches().catch(() => {});
    }
  }, [ownerChanges, loadWatches]);

  const handleRefresh = async () => {
    try {
      const [watchData] = await Promise.all([
        fetchWatches(),
        classNumbers.length > 0 ? refetchClassStates() : Promise.resolve(),
      ]);

      const watchCount = watchData.watches.length;

      const timeString = new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });

      toast.success(`Dashboard refreshed at ${timeString}`, {
        description: `Updated ${watchCount} class watch${watchCount !== 1 ? "es" : ""}`,
      });
    } catch (err) {
      toast.error("Failed to refresh dashboard", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    }
  };

  const { pullDistance, isRefreshing, containerRef } = usePullToRefresh({
    onRefresh: handleRefresh,
    threshold: 80,
    resistance: 2.5,
  });

  const handleOnboardingCompleted = useCallback(
    (watch: ClassWatchRow) => {
      setWatches((prev) => [{ ...watch, class_state: null }, ...prev]);
      setOnboarding((prev) => completeOnFirstWatch(prev));
      void router.invalidate();
    },
    [router],
  );

  const handleOnboardingSkipped = useCallback(
    (state: OnboardingState) => {
      setOnboarding(state);
      void router.invalidate();
    },
    [router],
  );

  const handleDeleteWatch = async (watchId: string) => {
    const response = await fetch(`/api/class-watches?id=${watchId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error("Failed to delete class watch");
    }

    setWatches((prev) => prev.filter((w) => w.id !== watchId));
    void router.invalidate();
  };

  const filteredWatches = useMemo(() => {
    if (!searchQuery.trim()) return watches;

    const query = searchQuery.toLowerCase();

    return watches.filter((watch) => {
      const liveState = classStates[sectionRefKey(watch)] || watch.class_state;

      return (
        watch.class_nbr.toLowerCase().includes(query) ||
        watch.subject?.toLowerCase().includes(query) ||
        watch.catalog_nbr?.toLowerCase().includes(query) ||
        liveState?.title?.toLowerCase().includes(query) ||
        liveState?.instructor_name?.toLowerCase().includes(query)
      );
    });
  }, [watches, searchQuery, classStates]);

  const stats = useMemo(() => {
    const totalWatches = watches.length;

    const availableSeats = watches.filter((watch) => {
      const liveState = classStates[sectionRefKey(watch)] || watch.class_state;

      return liveState && liveState.seats_available > 0;
    }).length;

    const fullClasses = watches.filter((watch) => {
      const liveState = classStates[sectionRefKey(watch)] || watch.class_state;

      return liveState && liveState.seats_available === 0;
    }).length;

    return { totalWatches, availableSeats, fullClasses };
  }, [watches, classStates]);

  return {
    watches,
    maxWatches,
    isLoadingWatches,
    error,
    searchQuery,
    setSearchQuery,
    onboarding,
    handleOnboardingSkipped,
    classStates,
    realtimeLoading,
    realtimeError,
    fetchWatches,
    handleDeleteWatch,
    handleOnboardingCompleted,
    filteredWatches,
    stats,
    pullDistance,
    isRefreshing,
    containerRef,
  };
}
