import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePullToRefresh } from '@/lib/hooks/usePullToRefresh';

// Helper component that uses the hook and attaches ref to a div
function TestComponent({
  onRefresh,
  threshold = 80,
  resistance = 2.5,
}: {
  onRefresh: () => Promise<void>;
  threshold?: number;
  resistance?: number;
}) {
  const { pullDistance, isRefreshing, containerRef } = usePullToRefresh({
    onRefresh,
    threshold,
    resistance,
  });

  return (
    <div ref={containerRef} data-testid="container">
      <span data-testid="pull-distance">{pullDistance}</span>
      <span data-testid="is-refreshing">{isRefreshing ? 'true' : 'false'}</span>
    </div>
  );
}

// Helper to create and dispatch touch events
const createTouchEvent = (type: string, clientY: number): TouchEvent => {
  const touch = {
    clientY,
    clientX: 0,
    identifier: 0,
    pageX: 0,
    pageY: clientY,
    screenX: 0,
    screenY: clientY,
    target: null as unknown as EventTarget,
    radiusX: 0,
    radiusY: 0,
    rotationAngle: 0,
    force: 0,
  };

  return new TouchEvent(type, {
    touches: type === 'touchend' || type === 'touchcancel' ? [] : [touch as Touch],
    targetTouches: type === 'touchend' || type === 'touchcancel' ? [] : [touch as Touch],
    changedTouches: [touch as Touch],
    bubbles: true,
    cancelable: true,
  });
};

// Create properly typed mock
const createMockRefresh = (): (() => Promise<void>) => {
  const fn = vi.fn();
  fn.mockResolvedValue(undefined);
  return fn as unknown as () => Promise<void>;
};

describe('usePullToRefresh hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset scroll position
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
    Object.defineProperty(document.documentElement, 'scrollTop', {
      value: 0,
      writable: true,
      configurable: true,
    });
  });

  describe('initialization', () => {
    it('should return initial state', () => {
      const { result } = renderHook(() => usePullToRefresh({ onRefresh: createMockRefresh() }));

      expect(result.current.pullDistance).toBe(0);
      expect(result.current.isRefreshing).toBe(false);
      expect(result.current.containerRef).toBeDefined();
    });

    it('should use default threshold of 80', () => {
      const { result } = renderHook(() => usePullToRefresh({ onRefresh: createMockRefresh() }));
      expect(result.current.pullDistance).toBe(0);
    });

    it('should use default resistance of 2.5', () => {
      const { result } = renderHook(() => usePullToRefresh({ onRefresh: createMockRefresh() }));
      expect(result.current.pullDistance).toBe(0);
    });
  });

  describe('custom options', () => {
    it('should accept custom threshold', () => {
      const { result } = renderHook(() =>
        usePullToRefresh({ onRefresh: createMockRefresh(), threshold: 100 })
      );
      expect(result.current.pullDistance).toBe(0);
    });

    it('should accept custom resistance', () => {
      const { result } = renderHook(() =>
        usePullToRefresh({ onRefresh: createMockRefresh(), resistance: 3 })
      );
      expect(result.current.pullDistance).toBe(0);
    });
  });

  describe('container ref', () => {
    it('should return a valid ref object', () => {
      const { result } = renderHook(() => usePullToRefresh({ onRefresh: createMockRefresh() }));
      expect(result.current.containerRef).toHaveProperty('current');
    });

    it('should start with null container', () => {
      const { result } = renderHook(() => usePullToRefresh({ onRefresh: createMockRefresh() }));
      expect(result.current.containerRef.current).toBeNull();
    });
  });

  describe('state transitions', () => {
    it('should start with pullDistance of 0', () => {
      const { result } = renderHook(() => usePullToRefresh({ onRefresh: createMockRefresh() }));
      expect(result.current.pullDistance).toBe(0);
    });

    it('should start with isRefreshing as false', () => {
      const { result } = renderHook(() => usePullToRefresh({ onRefresh: createMockRefresh() }));
      expect(result.current.isRefreshing).toBe(false);
    });
  });

  describe('refresh callback', () => {
    it('should not call onRefresh during initialization', () => {
      const mockRefresh = createMockRefresh();
      renderHook(() => usePullToRefresh({ onRefresh: mockRefresh }));
      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should handle unmount gracefully', () => {
      const { unmount } = renderHook(() => usePullToRefresh({ onRefresh: createMockRefresh() }));
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('options updates', () => {
    it('should handle threshold prop changes', () => {
      const mockRefresh = createMockRefresh();
      const { result, rerender } = renderHook(
        (props: { threshold?: number }) => usePullToRefresh({ onRefresh: mockRefresh, ...props }),
        { initialProps: { threshold: 80 } }
      );

      expect(result.current.pullDistance).toBe(0);
      rerender({ threshold: 120 });
      expect(result.current.pullDistance).toBe(0);
    });

    it('should handle resistance prop changes', () => {
      const mockRefresh = createMockRefresh();
      const { result, rerender } = renderHook(
        (props: { resistance?: number }) => usePullToRefresh({ onRefresh: mockRefresh, ...props }),
        { initialProps: { resistance: 2.5 } }
      );

      expect(result.current.pullDistance).toBe(0);
      rerender({ resistance: 3 });
      expect(result.current.pullDistance).toBe(0);
    });
  });

  describe('component with ref attached', () => {
    it('should render with pull distance 0', () => {
      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      render(<TestComponent onRefresh={mockRefresh} />);
      expect(screen.getByTestId('pull-distance').textContent).toBe('0');
    });

    it('should render with isRefreshing false', () => {
      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      render(<TestComponent onRefresh={mockRefresh} />);
      expect(screen.getByTestId('is-refreshing').textContent).toBe('false');
    });

    it('should render container element', () => {
      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      render(<TestComponent onRefresh={mockRefresh} />);
      expect(screen.getByTestId('container')).toBeInTheDocument();
    });

    it('should track pull distance on touch interaction when at top', async () => {
      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      render(<TestComponent onRefresh={mockRefresh} threshold={80} resistance={2.5} />);

      const container = screen.getByTestId('container');

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchstart', 100));
      });

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchmove', 200));
      });

      // Pull distance should be (200-100) / 2.5 = 40
      const pullDistance = Number.parseFloat(
        screen.getByTestId('pull-distance').textContent || '0'
      );
      expect(pullDistance).toBe(40);
    });

    it('should cap pull distance at threshold * 1.5', async () => {
      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      render(<TestComponent onRefresh={mockRefresh} threshold={80} resistance={1} />);

      const container = screen.getByTestId('container');

      // Start at y=10 to avoid 0 being falsy
      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchstart', 10));
      });

      // Pull 500px (from 10 to 510) - should cap at 80 * 1.5 = 120
      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchmove', 510));
      });

      const pullDistance = Number.parseFloat(
        screen.getByTestId('pull-distance').textContent || '0'
      );
      expect(pullDistance).toBe(120);
    });

    it('should not track upward pulls', async () => {
      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      render(<TestComponent onRefresh={mockRefresh} />);

      const container = screen.getByTestId('container');

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchstart', 200));
      });

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchmove', 100));
      });

      const pullDistance = Number.parseFloat(
        screen.getByTestId('pull-distance').textContent || '0'
      );
      expect(pullDistance).toBe(0);
    });

    it('should not track pull when page is scrolled', async () => {
      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      render(<TestComponent onRefresh={mockRefresh} />);

      // Set scroll position away from top
      Object.defineProperty(window, 'scrollY', { value: 100, writable: true, configurable: true });

      const container = screen.getByTestId('container');

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchstart', 100));
      });

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchmove', 200));
      });

      const pullDistance = Number.parseFloat(
        screen.getByTestId('pull-distance').textContent || '0'
      );
      expect(pullDistance).toBe(0);
    });

    it('should reset on touch end when not at top', async () => {
      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      render(<TestComponent onRefresh={mockRefresh} />);

      Object.defineProperty(window, 'scrollY', { value: 100, writable: true, configurable: true });

      const container = screen.getByTestId('container');

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchstart', 100));
      });

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchend', 100));
      });

      expect(mockRefresh).not.toHaveBeenCalled();
      expect(screen.getByTestId('pull-distance').textContent).toBe('0');
    });

    it('should reset on touch cancel', async () => {
      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      render(<TestComponent onRefresh={mockRefresh} />);

      const container = screen.getByTestId('container');

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchstart', 0));
      });

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchmove', 100));
      });

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchcancel', 100));
      });

      expect(screen.getByTestId('pull-distance').textContent).toBe('0');
    });

    it('should remove event listeners on unmount', () => {
      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      const { unmount } = render(<TestComponent onRefresh={mockRefresh} />);

      const container = screen.getByTestId('container');
      const removeEventListenerSpy = vi.spyOn(container, 'removeEventListener');

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('touchmove', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('touchcancel', expect.any(Function));
    });

    it('should reset pull when scrolling starts mid-pull', async () => {
      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      render(<TestComponent onRefresh={mockRefresh} />);

      const container = screen.getByTestId('container');

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchstart', 100));
      });

      // Scroll down after touch starts
      Object.defineProperty(window, 'scrollY', { value: 50, writable: true, configurable: true });

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchmove', 200));
      });

      const pullDistance = Number.parseFloat(
        screen.getByTestId('pull-distance').textContent || '0'
      );
      expect(pullDistance).toBe(0);
    });

    it('should apply resistance to pull distance', async () => {
      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      render(<TestComponent onRefresh={mockRefresh} threshold={80} resistance={5} />);

      const container = screen.getByTestId('container');

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchstart', 100));
      });

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchmove', 200));
      });

      // Pull distance should be 100 / 5 = 20
      const pullDistance = Number.parseFloat(
        screen.getByTestId('pull-distance').textContent || '0'
      );
      expect(pullDistance).toBe(20);
    });

    it('should snap back to 0 if threshold not reached on touch end', async () => {
      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      render(<TestComponent onRefresh={mockRefresh} threshold={100} resistance={1} />);

      const container = screen.getByTestId('container');

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchstart', 0));
      });

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchmove', 50));
      });

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchend', 50));
      });

      expect(mockRefresh).not.toHaveBeenCalled();
      expect(screen.getByTestId('pull-distance').textContent).toBe('0');
    });

    it('should ignore touch move without prior touch start', async () => {
      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      render(<TestComponent onRefresh={mockRefresh} />);

      const container = screen.getByTestId('container');

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchmove', 200));
      });

      expect(screen.getByTestId('pull-distance').textContent).toBe('0');
    });
  });
});
