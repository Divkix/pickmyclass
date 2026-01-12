import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSwipe } from '@/lib/hooks/useSwipe';

// Helper to create mock touch events
const createTouchEvent = (clientX: number): React.TouchEvent => {
  return {
    touches: [{ clientX }],
  } as unknown as React.TouchEvent;
};

describe('useSwipe hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should return initial state with offset 0 and not swiping', () => {
      const { result } = renderHook(() => useSwipe());

      expect(result.current.offset).toBe(0);
      expect(result.current.isSwiping).toBe(false);
    });

    it('should return handlers object with touch event handlers', () => {
      const { result } = renderHook(() => useSwipe());

      expect(result.current.handlers).toHaveProperty('onTouchStart');
      expect(result.current.handlers).toHaveProperty('onTouchMove');
      expect(result.current.handlers).toHaveProperty('onTouchEnd');
    });

    it('should use default threshold of 100 if not specified', () => {
      const onSwipeLeft = vi.fn();
      const { result } = renderHook(() => useSwipe({ onSwipeLeft }));

      // Swipe 99px (below threshold) - should not trigger
      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100));
      });
      act(() => {
        result.current.handlers.onTouchMove(createTouchEvent(1)); // -99px swipe
      });
      act(() => {
        result.current.handlers.onTouchEnd();
      });

      expect(onSwipeLeft).not.toHaveBeenCalled();
    });
  });

  describe('swipe left detection', () => {
    it('should trigger onSwipeLeft when swiping left past threshold', () => {
      const onSwipeLeft = vi.fn();
      const { result } = renderHook(() => useSwipe({ onSwipeLeft, threshold: 50 }));

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(200));
      });
      act(() => {
        result.current.handlers.onTouchMove(createTouchEvent(100)); // -100px swipe
      });
      act(() => {
        result.current.handlers.onTouchEnd();
      });

      expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    });

    it('should not trigger onSwipeLeft when swipe distance is below threshold', () => {
      const onSwipeLeft = vi.fn();
      const { result } = renderHook(() => useSwipe({ onSwipeLeft, threshold: 100 }));

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100));
      });
      act(() => {
        result.current.handlers.onTouchMove(createTouchEvent(50)); // -50px swipe
      });
      act(() => {
        result.current.handlers.onTouchEnd();
      });

      expect(onSwipeLeft).not.toHaveBeenCalled();
    });
  });

  describe('swipe right detection', () => {
    it('should trigger onSwipeRight when swiping right past threshold', () => {
      const onSwipeRight = vi.fn();
      const { result } = renderHook(() => useSwipe({ onSwipeRight, threshold: 50 }));

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100));
      });
      act(() => {
        result.current.handlers.onTouchMove(createTouchEvent(200)); // +100px swipe
      });
      act(() => {
        result.current.handlers.onTouchEnd();
      });

      expect(onSwipeRight).toHaveBeenCalledTimes(1);
    });

    it('should not trigger onSwipeRight when swipe distance is below threshold', () => {
      const onSwipeRight = vi.fn();
      const { result } = renderHook(() => useSwipe({ onSwipeRight, threshold: 100 }));

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100));
      });
      act(() => {
        result.current.handlers.onTouchMove(createTouchEvent(150)); // +50px swipe
      });
      act(() => {
        result.current.handlers.onTouchEnd();
      });

      expect(onSwipeRight).not.toHaveBeenCalled();
    });
  });

  describe('swipe lifecycle callbacks', () => {
    it('should call onSwipeStart when touch begins', () => {
      const onSwipeStart = vi.fn();
      const { result } = renderHook(() => useSwipe({ onSwipeStart }));

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100));
      });

      expect(onSwipeStart).toHaveBeenCalledTimes(1);
    });

    it('should call onSwipeMove with offset during swipe', () => {
      const onSwipeMove = vi.fn();
      const { result } = renderHook(() => useSwipe({ onSwipeMove }));

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100));
      });
      act(() => {
        result.current.handlers.onTouchMove(createTouchEvent(150));
      });

      expect(onSwipeMove).toHaveBeenCalledWith(50); // 150 - 100 = 50
    });

    it('should call onSwipeEnd when touch ends', () => {
      const onSwipeEnd = vi.fn();
      const { result } = renderHook(() => useSwipe({ onSwipeEnd }));

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100));
      });
      act(() => {
        result.current.handlers.onTouchMove(createTouchEvent(150));
      });
      act(() => {
        result.current.handlers.onTouchEnd();
      });

      expect(onSwipeEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe('state management', () => {
    it('should set isSwiping to true on touch start', () => {
      const { result } = renderHook(() => useSwipe());

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100));
      });

      expect(result.current.isSwiping).toBe(true);
    });

    it('should reset isSwiping to false on touch end', () => {
      const { result } = renderHook(() => useSwipe());

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100));
      });
      act(() => {
        result.current.handlers.onTouchMove(createTouchEvent(150));
      });
      act(() => {
        result.current.handlers.onTouchEnd();
      });

      expect(result.current.isSwiping).toBe(false);
    });

    it('should update offset during swipe', () => {
      const { result } = renderHook(() => useSwipe());

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100));
      });
      act(() => {
        result.current.handlers.onTouchMove(createTouchEvent(175));
      });

      expect(result.current.offset).toBe(75);
    });

    it('should reset offset to 0 on touch end', () => {
      const { result } = renderHook(() => useSwipe());

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(100));
      });
      act(() => {
        result.current.handlers.onTouchMove(createTouchEvent(150));
      });
      act(() => {
        result.current.handlers.onTouchEnd();
      });

      expect(result.current.offset).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should not update offset when not swiping', () => {
      const { result } = renderHook(() => useSwipe());

      act(() => {
        result.current.handlers.onTouchMove(createTouchEvent(150));
      });

      expect(result.current.offset).toBe(0);
    });

    it('should handle touch end when not swiping', () => {
      const onSwipeEnd = vi.fn();
      const { result } = renderHook(() => useSwipe({ onSwipeEnd }));

      act(() => {
        result.current.handlers.onTouchEnd();
      });

      // Should not call onSwipeEnd when not swiping
      expect(onSwipeEnd).not.toHaveBeenCalled();
    });

    it('should handle negative offset (swipe left)', () => {
      const { result } = renderHook(() => useSwipe());

      act(() => {
        result.current.handlers.onTouchStart(createTouchEvent(200));
      });
      act(() => {
        result.current.handlers.onTouchMove(createTouchEvent(100));
      });

      expect(result.current.offset).toBe(-100);
    });
  });
});
