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
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRefreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);

  // Keep ref in sync with latest prop so listeners see the latest handler
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  // Stable event handler refs — subscriptions stay put, latest logic is always called
  const handleTouchStart = useCallback((e: TouchEvent) => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    isAtTop.current = scrollTop === 0;

    if (isAtTop.current && !isRefreshingRef.current) {
      touchStartY.current = e.touches[0].clientY;
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isAtTop.current || isRefreshingRef.current || touchStartY.current === 0) {
        return;
      }

      const touchY = e.touches[0].clientY;
      const pullDelta = touchY - touchStartY.current;

      if (pullDelta > 0) {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        if (scrollTop > 0) {
          isAtTop.current = false;
          touchStartY.current = 0;
          setPullDistance(0);
          currentPullDistance.current = 0;
          return;
        }

        const distance = Math.min(pullDelta / resistance, threshold * 1.5);
        currentPullDistance.current = distance;
        setPullDistance(distance);

        if (distance > 10) {
          e.preventDefault();
        }
      }
    },
    [threshold, resistance]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isAtTop.current || isRefreshingRef.current) {
      touchStartY.current = 0;
      setPullDistance(0);
      currentPullDistance.current = 0;
      return;
    }

    if (currentPullDistance.current >= threshold) {
      setIsRefreshing(true);
      isRefreshingRef.current = true;
      setPullDistance(threshold);

      try {
        await onRefreshRef.current();
      } catch (error) {
        console.error('Refresh failed:', error);
      } finally {
        setIsRefreshing(false);
        isRefreshingRef.current = false;
        if (resetTimeoutRef.current) {
          clearTimeout(resetTimeoutRef.current);
        }
        resetTimeoutRef.current = setTimeout(() => {
          setPullDistance(0);
          currentPullDistance.current = 0;
        }, 100);
      }
    } else {
      setPullDistance(0);
      currentPullDistance.current = 0;
    }

    touchStartY.current = 0;
    isAtTop.current = false;
  }, [threshold]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
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
