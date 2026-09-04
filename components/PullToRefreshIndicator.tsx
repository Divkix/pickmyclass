'use client';

import { Loader2 } from 'lucide-react';

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  isRefreshing: boolean;
  threshold: number;
}

export function PullToRefreshIndicator({
  pullDistance,
  isRefreshing,
  threshold,
}: PullToRefreshIndicatorProps) {
  const opacity = Math.min(pullDistance / threshold, 1);
  const rotation = isRefreshing ? 0 : (pullDistance / threshold) * 360;
  const height = Math.min(pullDistance, 80);

  const getMessage = () => {
    if (isRefreshing) return 'Refreshing...';
    if (pullDistance >= threshold) return 'Release to refresh';
    if (pullDistance > 0) return 'Pull to refresh';
    return '';
  };

  const message = getMessage();

  if (pullDistance === 0 && !isRefreshing) return null;

  return (
    <div
      className="fixed top-0 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-[opacity,height] duration-100 ease-out"
      style={{
        opacity,
        height: `${height}px`,
      }}
    >
      <div className="flex flex-col items-center justify-center h-full gap-2 pt-4">
        <div
          className={`transition-transform duration-200 ${isRefreshing ? 'animate-spin' : ''}`}
          style={{
            transform: isRefreshing ? 'none' : `rotate(${rotation}deg)`,
          }}
        >
          <Loader2 className="size-6 text-primary" />
        </div>
        {message && <span className="text-xs font-medium text-muted-foreground">{message}</span>}
      </div>
    </div>
  );
}
