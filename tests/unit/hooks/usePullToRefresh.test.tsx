import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { usePullToRefresh } from '@/lib/hooks/usePullToRefresh';

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

const createTouchEvent = (type: string, clientY: number): TouchEvent => {
  const touch = {
    clientY,
    clientX: 0,
    identifier: 0,
    pageX: 0,
    pageY: clientY,
    screenX: 0,
    screenY: clientY,
    // eslint-disable-next-line anti-slop/no-chained-type-assertions
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

describe('usePullToRefresh hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
    Object.defineProperty(document.documentElement, 'scrollTop', {
      value: 0,
      writable: true,
      configurable: true,
    });
  });

  describe('touch-interaction math', () => {
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

      const pullDistance = Number.parseFloat(
        screen.getByTestId('pull-distance').textContent || '0'
      );
      expect(pullDistance).toBe(40);
    });

    it('should cap pull distance at threshold * 1.5', async () => {
      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      render(<TestComponent onRefresh={mockRefresh} threshold={80} resistance={1} />);

      const container = screen.getByTestId('container');

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchstart', 10));
      });

      await act(async () => {
        container.dispatchEvent(createTouchEvent('touchmove', 510));
      });

      const pullDistance = Number.parseFloat(
        screen.getByTestId('pull-distance').textContent || '0'
      );
      expect(pullDistance).toBe(120);
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
  });
});
