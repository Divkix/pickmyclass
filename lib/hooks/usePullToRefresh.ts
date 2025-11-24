'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number; // pixels to trigger refresh (default: 80)
  resistance?: number; // pull resistance factor (default: 2.5)
}

export interface UsePullToRefreshReturn {
  pullDistance: number;
  isRefreshing: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Hook to enable pull-to-refresh functionality for mobile devices
 * Only triggers when scrolled to the top of the page
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  resistance = 2.5,
}: UsePullToRefreshOptions): UsePullToRefreshReturn {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number>(0);
  const currentPullDistance = useRef<number>(0);
  const isAtTop = useRef<boolean>(false);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      // Only start tracking if we're at the top of the page
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      isAtTop.current = scrollTop === 0;

      if (isAtTop.current && !isRefreshing) {
        touchStartY.current = e.touches[0].clientY;
      }
    },
    [isRefreshing]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isAtTop.current || isRefreshing || touchStartY.current === 0) {
        return;
      }

      const touchY = e.touches[0].clientY;
      const pullDelta = touchY - touchStartY.current;

      // Only handle downward pulls (positive delta)
      if (pullDelta > 0) {
        // Check if we're still at the top
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        if (scrollTop > 0) {
          isAtTop.current = false;
          touchStartY.current = 0;
          setPullDistance(0);
          currentPullDistance.current = 0;
          return;
        }

        // Apply resistance to make the pull feel natural
        const distance = Math.min(pullDelta / resistance, threshold * 1.5);
        currentPullDistance.current = distance;
        setPullDistance(distance);

        // Prevent default scrolling when pulling
        if (distance > 10) {
          e.preventDefault();
        }
      }
    },
    [isRefreshing, threshold, resistance]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isAtTop.current || isRefreshing) {
      touchStartY.current = 0;
      setPullDistance(0);
      currentPullDistance.current = 0;
      return;
    }

    // Trigger refresh if threshold exceeded
    if (currentPullDistance.current >= threshold) {
      setIsRefreshing(true);
      setPullDistance(threshold); // Lock at threshold during refresh

      try {
        await onRefresh();
      } catch (error) {
        console.error('Refresh failed:', error);
      } finally {
        // Animate back to 0
        setIsRefreshing(false);
        setTimeout(() => {
          setPullDistance(0);
          currentPullDistance.current = 0;
        }, 100);
      }
    } else {
      // Snap back to 0 if threshold not reached
      setPullDistance(0);
      currentPullDistance.current = 0;
    }

    touchStartY.current = 0;
    isAtTop.current = false;
  }, [isRefreshing, threshold, onRefresh]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Add passive: false to allow preventDefault
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return {
    pullDistance,
    isRefreshing,
    containerRef,
  };
}
