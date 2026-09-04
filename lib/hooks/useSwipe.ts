import { useCallback, useRef, useState } from 'react';

export interface UseSwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number;
  onSwipeStart?: () => void;
  onSwipeMove?: (offset: number) => void;
  onSwipeEnd?: () => void;
}

export interface UseSwipeReturn {
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
  };
  offset: number;
  isSwiping: boolean;
}

export function useSwipe(options: UseSwipeOptions = {}): UseSwipeReturn {
  const {
    onSwipeLeft,
    onSwipeRight,
    threshold = 100,
    onSwipeStart,
    onSwipeMove,
    onSwipeEnd,
  } = options;

  const [offset, setOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartX = useRef<number>(0);
  const touchCurrentX = useRef<number>(0);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      touchStartX.current = e.touches[0].clientX;
      touchCurrentX.current = e.touches[0].clientX;
      setIsSwiping(true);
      onSwipeStart?.();
    },
    [onSwipeStart]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isSwiping) return;

      touchCurrentX.current = e.touches[0].clientX;
      const diff = touchCurrentX.current - touchStartX.current;

      setOffset(diff);
      onSwipeMove?.(diff);
    },
    [isSwiping, onSwipeMove]
  );

  const handleTouchEnd = useCallback(() => {
    if (!isSwiping) return;

    const swipeDistance = touchCurrentX.current - touchStartX.current;
    const absDistance = Math.abs(swipeDistance);

    if (absDistance >= threshold) {
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }

      if (swipeDistance < 0) {
        onSwipeLeft?.();
      } else {
        onSwipeRight?.();
      }
    }

    setIsSwiping(false);
    setOffset(0);
    touchStartX.current = 0;
    touchCurrentX.current = 0;
    onSwipeEnd?.();
  }, [isSwiping, threshold, onSwipeLeft, onSwipeRight, onSwipeEnd]);

  return {
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
    offset,
    isSwiping,
  };
}
