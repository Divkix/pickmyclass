'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { OnboardingState } from '@/components/OnboardingModal';
import { useAuth } from '@/lib/contexts/AuthContext';
import { usePullToRefresh } from '@/lib/hooks/usePullToRefresh';
import { useRealtimeClassStates } from '@/lib/hooks/useRealtimeClassStates';
import { completeOnFirstWatch } from '@/lib/onboarding';
import { sectionRefKey } from '@/lib/section-ref';
import type { ClassStateRow, ClassWatchRow } from '@/lib/types/class-watch';

type ClassWatch = ClassWatchRow & {
  class_state?: ClassStateRow | null;
};

interface GetClassWatchesResponse {
  watches: ClassWatch[];
  maxWatches: number;
  onboarding?: OnboardingState;
}

export interface ClassWatchStats {
  totalWatches: number;
  availableSeats: number;
  fullClasses: number;
}

export function useClassWatches() {
  const { user, loading: authLoading } = useAuth();
  const [watches, setWatches] = useState<ClassWatch[]>([]);
  const [maxWatches, setMaxWatches] = useState<number>(10);
  const [isLoadingWatches, setIsLoadingWatches] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);

  const classNumbers = useMemo(() => watches.map((w) => w.class_nbr), [watches]);

  const {
    classStates,
    loading: realtimeLoading,
    error: realtimeError,
    refetch: refetchClassStates,
  } = useRealtimeClassStates({
    classNumbers,
    enabled: classNumbers.length > 0,
  });

  const fetchWatches = useCallback(async (): Promise<GetClassWatchesResponse> => {
    try {
      setIsLoadingWatches(true);
      setError(null);

      const response = await fetch('/api/class-watches');

      if (!response.ok) {
        throw new Error('Failed to fetch class watches');
      }

      // SAFETY: /api/class-watches returns JSON shaped as GetClassWatchesResponse per API contract
      const data = (await response.json()) as GetClassWatchesResponse;
      setWatches(data.watches || []);
      setMaxWatches(data.maxWatches || 10);

      if (data.onboarding) setOnboarding(data.onboarding);

      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load class watches';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoadingWatches(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      void fetchWatches().catch(() => {});
    }
  }, [user, fetchWatches]);

  const handleRefresh = async () => {
    try {
      const [watchData] = await Promise.all([
        fetchWatches(),
        classNumbers.length > 0 ? refetchClassStates() : Promise.resolve(),
      ]);

      const watchCount = watchData?.watches?.length ?? watches.length;

      const timeString = new Date().toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });

      toast.success(`Dashboard refreshed at ${timeString}`, {
        description: `Updated ${watchCount} class watch${watchCount !== 1 ? 'es' : ''}`,
      });
    } catch (err) {
      toast.error('Failed to refresh dashboard', {
        description: err instanceof Error ? err.message : 'Please try again',
      });
    }
  };

  const { pullDistance, isRefreshing, containerRef } = usePullToRefresh({
    onRefresh: handleRefresh,
    threshold: 80,
    resistance: 2.5,
  });

  const handleOnboardingCompleted = useCallback((watch: ClassWatch) => {
    setWatches((prev) => [watch, ...prev]);
    setOnboarding((prev) => (prev ? completeOnFirstWatch(prev) : prev));
  }, []);

  const handleDeleteWatch = async (watchId: string) => {
    const response = await fetch(`/api/class-watches?id=${watchId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to delete class watch');
    }

    setWatches((prev) => prev.filter((w) => w.id !== watchId));
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
    user,
    authLoading,
    watches,
    maxWatches,
    isLoadingWatches,
    error,
    searchQuery,
    setSearchQuery,
    onboarding,
    setOnboarding,
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
