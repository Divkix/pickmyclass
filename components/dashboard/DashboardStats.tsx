'use client';

import { m } from 'framer-motion';
import { CheckCircle2, Eye, TrendingUp, Users, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { staggerContainer, staggerItem } from '@/lib/animations';
import type { ClassWatchStats } from '@/lib/hooks/useClassWatches';

interface StatCard {
  title: string;
  icon: LucideIcon;
  iconClassName: string;
  body: ReactNode;
}

interface DashboardStatsProps {
  stats: ClassWatchStats;
  maxWatches: number;
  realtimeLoading: boolean;
}

export function DashboardStats({ stats, maxWatches, realtimeLoading }: DashboardStatsProps) {
  const statCards: StatCard[] = [
    {
      title: 'Total Watches',
      icon: Eye,
      iconClassName: 'text-muted-foreground',
      body: (
        <>
          <div className="text-2xl font-bold">{stats.totalWatches}</div>
          <p className="text-xs text-muted-foreground">
            {maxWatches - stats.totalWatches} remaining
          </p>
        </>
      ),
    },
    {
      title: 'Available',
      icon: CheckCircle2,
      iconClassName: 'text-success',
      body: (
        <>
          <div className="text-2xl font-bold text-success">{stats.availableSeats}</div>
          <p className="text-xs text-muted-foreground">
            {stats.availableSeats > 0 ? 'Go register now!' : 'Classes with open seats'}
          </p>
        </>
      ),
    },
    {
      title: 'Full',
      icon: Users,
      iconClassName: 'text-destructive',
      body: (
        <>
          <div className="text-2xl font-bold text-destructive">{stats.fullClasses}</div>
          <p className="text-xs text-muted-foreground">
            {stats.fullClasses > 0 ? "We'll alert you when seats open" : 'Classes at capacity'}
          </p>
        </>
      ),
    },
    {
      title: 'Status',
      icon: TrendingUp,
      iconClassName: 'text-primary',
      body: (
        <>
          <div className="flex items-center gap-2">
            {realtimeLoading ? (
              <span className="text-sm text-muted-foreground animate-pulse">Syncing...</span>
            ) : (
              <>
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-success" />
                </span>
                <span className="text-sm font-medium text-success">Watching 24/7</span>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">We check every 30 minutes</p>
        </>
      ),
    },
  ];

  return (
    <m.div
      className="mb-8 grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4"
      initial="hidden"
      animate="visible"
      variants={staggerContainer}
    >
      {statCards.map(({ title, icon: Icon, iconClassName, body }) => (
        <m.div key={title} variants={staggerItem}>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
                <Icon className={`size-4 ${iconClassName}`} />
              </div>
            </CardHeader>
            <CardContent>{body}</CardContent>
          </Card>
        </m.div>
      ))}
    </m.div>
  );
}
