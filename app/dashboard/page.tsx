'use client';

import { motion } from 'framer-motion';
import { Calendar, CheckCircle2, Eye, Plus, Search, TrendingUp, Users } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ClassWatchCard } from '@/components/ClassWatchCard';
import { Header } from '@/components/Header';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fadeInUp, staggerContainer, staggerItem } from '@/lib/animations';
import { useAuth } from '@/lib/contexts/AuthContext';
import { usePullToRefresh } from '@/lib/hooks/usePullToRefresh';
import { useRealtimeClassStates } from '@/lib/hooks/useRealtimeClassStates';
import type { Database } from '@/lib/supabase/database.types';

type ClassWatch = Database['public']['Tables']['class_watches']['Row'] & {
  class_state?: Database['public']['Tables']['class_states']['Row'] | null;
};

interface GetClassWatchesResponse {
  watches: ClassWatch[];
  maxWatches: number;
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const [watches, setWatches] = useState<ClassWatch[]>([]);
  const [maxWatches, setMaxWatches] = useState<number>(10);
  const [isLoadingWatches, setIsLoadingWatches] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Get class numbers from watches for Realtime subscription
  const classNumbers = watches.map((w) => w.class_nbr);

  // Subscribe to real-time updates
  const {
    classStates,
    loading: realtimeLoading,
    refetch: refetchClassStates,
  } = useRealtimeClassStates({
    classNumbers,
    enabled: classNumbers.length > 0,
  });

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      redirect('/login');
    }
  }, [user, authLoading]);

  // Fetch user's class watches
  const fetchWatches = useCallback(async () => {
    try {
      setIsLoadingWatches(true);
      setError(null);

      const response = await fetch('/api/class-watches');
      if (!response.ok) {
        throw new Error('Failed to fetch class watches');
      }

      const data = (await response.json()) as GetClassWatchesResponse;
      setWatches(data.watches || []);
      setMaxWatches(data.maxWatches || 10);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load class watches');
    } finally {
      setIsLoadingWatches(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchWatches();
    }
  }, [user, fetchWatches]);

  // Handle pull-to-refresh
  const handleRefresh = async () => {
    try {
      // Re-fetch class watches and class states in parallel
      await Promise.all([
        fetchWatches(),
        classNumbers.length > 0 ? refetchClassStates() : Promise.resolve(),
      ]);

      // Show success toast with count and timestamp
      const timeString = new Date().toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      toast.success(`Dashboard refreshed at ${timeString}`, {
        description: `Updated ${watches.length} class watch${watches.length !== 1 ? 'es' : ''}`,
      });
    } catch (err) {
      toast.error('Failed to refresh dashboard', {
        description: err instanceof Error ? err.message : 'Please try again',
      });
    }
  };

  // Pull-to-refresh hook
  const { pullDistance, isRefreshing, containerRef } = usePullToRefresh({
    onRefresh: handleRefresh,
    threshold: 80,
    resistance: 2.5,
  });

  // Handle deleting a watch
  const handleDeleteWatch = async (watchId: string) => {
    const response = await fetch(`/api/class-watches?id=${watchId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to delete class watch');
    }

    // Remove from local state immediately
    setWatches((prev) => prev.filter((w) => w.id !== watchId));
  };

  // Filter watches based on search query
  const filteredWatches = useMemo(() => {
    if (!searchQuery.trim()) return watches;

    const query = searchQuery.toLowerCase();
    return watches.filter((watch) => {
      const liveState = classStates[watch.class_nbr] || watch.class_state;
      return (
        watch.class_nbr.toLowerCase().includes(query) ||
        watch.subject?.toLowerCase().includes(query) ||
        watch.catalog_nbr?.toLowerCase().includes(query) ||
        liveState?.title?.toLowerCase().includes(query) ||
        liveState?.instructor_name?.toLowerCase().includes(query)
      );
    });
  }, [watches, searchQuery, classStates]);

  // Calculate quick stats
  const stats = useMemo(() => {
    const totalWatches = watches.length;
    const availableSeats = watches.filter((watch) => {
      const liveState = classStates[watch.class_nbr] || watch.class_state;
      return liveState && liveState.seats_available > 0;
    }).length;
    const fullClasses = watches.filter((watch) => {
      const liveState = classStates[watch.class_nbr] || watch.class_state;
      return liveState && liveState.seats_available === 0;
    }).length;

    return { totalWatches, availableSeats, fullClasses };
  }, [watches, classStates]);

  // Show loading state while checking auth
  if (authLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <Skeleton className="h-8 w-64 mb-6" />
          <Skeleton className="h-32 w-full mb-4" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  // User is not authenticated (will redirect)
  if (!user) {
    return null;
  }

  return (
    <div ref={containerRef} className="flex min-h-screen flex-col bg-background">
      <Header />
      <PullToRefreshIndicator
        pullDistance={pullDistance}
        isRefreshing={isRefreshing}
        threshold={80}
      />
      <main className="container mx-auto px-4 py-6 sm:py-8 max-w-7xl">
        {/* Page Header */}
        <motion.div className="mb-8" initial="hidden" animate="visible" variants={fadeInUp}>
          <h1 className="text-3xl font-bold mb-2 sm:text-4xl">Class Watch Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor University classes for seat availability and instructor assignments.
          </p>
        </motion.div>

        {error && (
          <Alert className="mb-6 bg-destructive/10 text-destructive border-destructive/20">
            {error}
          </Alert>
        )}

        {/* Quick Stats */}
        {!isLoadingWatches && watches.length > 0 && (
          <motion.div
            className="mb-8 grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4"
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
          >
            <motion.div variants={staggerItem}>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Total Watches
                    </CardTitle>
                    <Eye className="size-4 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.totalWatches}</div>
                  <p className="text-xs text-muted-foreground">
                    {maxWatches - stats.totalWatches} remaining
                  </p>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={staggerItem}>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Available
                    </CardTitle>
                    <CheckCircle2 className="size-4 text-success" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-success">{stats.availableSeats}</div>
                  <p className="text-xs text-muted-foreground">Classes with open seats</p>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={staggerItem}>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Full
                    </CardTitle>
                    <Users className="size-4 text-destructive" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">{stats.fullClasses}</div>
                  <p className="text-xs text-muted-foreground">Classes at capacity</p>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={staggerItem}>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Status
                    </CardTitle>
                    <TrendingUp className="size-4 text-primary" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    {realtimeLoading ? (
                      <span className="text-sm text-muted-foreground animate-pulse">
                        Syncing...
                      </span>
                    ) : (
                      <span className="text-sm font-medium text-success">Live</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Real-time updates active</p>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}

        {/* Search and Add Button */}
        <motion.div
          className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
          initial="hidden"
          animate="visible"
          variants={fadeInUp}
        >
          {watches.length > 0 && (
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search classes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-3 pl-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}

          <Link href="/dashboard/add" className="w-full sm:w-auto">
            <Button variant="gradient" className="w-full gap-2 sm:w-auto">
              <Plus className="size-4" />
              Add Class
            </Button>
          </Link>
        </motion.div>

        {/* Loading state */}
        {isLoadingWatches && (
          <div className="grid gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        )}

        {/* Empty state */}
        {!isLoadingWatches && watches.length === 0 && (
          <motion.div
            className="text-center py-16 bg-muted/20 rounded-xl border-2 border-dashed border-border"
            initial="hidden"
            animate="visible"
            variants={fadeInUp}
          >
            <div className="flex size-12 sm:size-16 items-center justify-center rounded-full bg-primary/10 mx-auto mb-4">
              <Calendar className="size-6 sm:size-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No class watches yet</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              Add your first class to start monitoring for seat availability and instructor
              assignments.
            </p>
            <Link href="/dashboard/add">
              <Button variant="gradient">
                <Plus className="size-4" />
                Add Your First Class
              </Button>
            </Link>
          </motion.div>
        )}

        {/* Class watches grid */}
        {!isLoadingWatches && filteredWatches.length > 0 && (
          <motion.div
            className="grid gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3"
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
          >
            {filteredWatches.map((watch) => {
              const liveState = classStates[watch.class_nbr] || watch.class_state || null;

              return (
                <motion.div key={watch.id} variants={staggerItem}>
                  <ClassWatchCard
                    watch={watch}
                    classState={liveState}
                    onDelete={handleDeleteWatch}
                  />
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* No search results */}
        {!isLoadingWatches && watches.length > 0 && filteredWatches.length === 0 && (
          <motion.div
            className="text-center py-12"
            initial="hidden"
            animate="visible"
            variants={fadeInUp}
          >
            <Search className="size-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No results found</h3>
            <p className="text-muted-foreground">Try adjusting your search query</p>
          </motion.div>
        )}
      </main>
    </div>
  );
}
