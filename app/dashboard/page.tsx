'use client';

import { m } from 'framer-motion';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ClassWatchCard } from '@/components/ClassWatchCard';
import { DashboardStats } from '@/components/dashboard/DashboardStats';
import { EmptyWatchlist, NoSearchResults } from '@/components/dashboard/EmptyStates';
import { FinishSetupCard } from '@/components/FinishSetupCard';
import { Header } from '@/components/Header';
import { OnboardingModal } from '@/components/OnboardingModal';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fadeInUp, staggerContainer, staggerItem } from '@/lib/animations';
import { useClassWatches } from '@/lib/hooks/useClassWatches';
import { useRequireAuth } from '@/lib/hooks/useRequireAuth';
import { sectionRefKey } from '@/lib/section-ref';

export default function DashboardPage() {
  useRequireAuth();

  const {
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
  } = useClassWatches();

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
      <OnboardingModal
        open={onboarding?.needs_onboarding === true}
        onSkipped={setOnboarding}
        onCompleted={handleOnboardingCompleted}
        onSkipError={(message) =>
          toast.error('Could not skip onboarding', { description: message })
        }
      />
      <main id="main" tabIndex={-1} className="container mx-auto px-4 py-6 sm:py-8 max-w-7xl">
        <m.div className="mb-8" initial="hidden" animate="visible" variants={fadeInUp}>
          <h1 className="text-3xl font-semibold mb-2 sm:text-4xl">Your Class Watchlist</h1>
          <p className="text-muted-foreground">
            We're keeping an eye on your ASU classes so you don't have to.
          </p>
        </m.div>

        {error && (
          <Alert className="mb-6 bg-destructive/10 text-destructive border-destructive/20">
            {error}
          </Alert>
        )}

        {realtimeError && (
          <Alert className="mb-6 bg-warning/10 text-warning border-warning/20">
            Live updates unavailable: {realtimeError.message}
          </Alert>
        )}

        {!isLoadingWatches &&
          watches.length === 0 &&
          onboarding?.onboarding_skipped_at &&
          !onboarding.onboarding_completed_at && <FinishSetupCard />}

        {!isLoadingWatches && watches.length > 0 && (
          <DashboardStats stats={stats} maxWatches={maxWatches} realtimeLoading={realtimeLoading} />
        )}

        <m.div
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
                aria-label="Search watched classes"
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
        </m.div>

        {isLoadingWatches && (
          <div className="grid gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        )}

        {!isLoadingWatches && watches.length === 0 && <EmptyWatchlist />}

        {!isLoadingWatches && filteredWatches.length > 0 && (
          <m.div
            className="grid gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3"
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
          >
            {filteredWatches.map((watch) => {
              const liveState = classStates[sectionRefKey(watch)] || watch.class_state || null;

              return (
                <m.div key={watch.id} variants={staggerItem}>
                  <ClassWatchCard
                    watch={watch}
                    classState={liveState}
                    onDelete={handleDeleteWatch}
                    onRestore={fetchWatches}
                  />
                </m.div>
              );
            })}
          </m.div>
        )}

        {!isLoadingWatches && watches.length > 0 && filteredWatches.length === 0 && (
          <NoSearchResults />
        )}
      </main>
    </div>
  );
}
