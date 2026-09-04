'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { log } from '@/lib/log';

export interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  resistance?: number;
}

export interface UsePullToRefreshReturn {
  pullDistance: number;
  isRefreshing: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

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

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
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
    [isRefreshing, threshold, resistance]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isAtTop.current || isRefreshing) {
      touchStartY.current = 0;
      setPullDistance(0);
      currentPullDistance.current = 0;
      return;
    }

    if (currentPullDistance.current >= threshold) {
      setIsRefreshing(true);

      try {
        await onRefresh();
      } catch (error) {
        log('PullToRefresh').error('Refresh failed:', error);
      } finally {
        setIsRefreshing(false);
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
  }, [isRefreshing, threshold, onRefresh]);

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
