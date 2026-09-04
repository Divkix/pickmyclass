import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { ClassWatchCard } from '@/components/ClassWatchCard';
import type { ClassStateRow, ClassWatchRow } from '@/lib/types/class-watch';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type MotionValue = JsonValue | React.ReactNode | ((e: React.TouchEvent) => void) | (() => void);
type MotionDivState = { current: Record<string, MotionValue> };

const { mockCreateWatch, mockToastError, mockToastSuccess, motionDivProps } = vi.hoisted(() => ({
  mockCreateWatch: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  motionDivProps: { current: {} } as MotionDivState,
}));

vi.mock('sonner', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

vi.mock('@/lib/class-watches/class-watch-creation', () => ({
  classWatchCreation: { create: mockCreateWatch },
}));

vi.mock('framer-motion', () => ({
  m: {
    div: ({ children, ...props }: { children: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
    button: ({ children, ...props }: { children: React.ReactNode }) => (
      <button {...props}>{children}</button>
    ),
  },
  motion: {
    div: (props: { children?: React.ReactNode }) => {
      motionDivProps.current = props as Record<string, MotionValue>;
      return <div {...props}>{props.children}</div>;
    },
    button: ({ children, ...props }: { children: React.ReactNode }) => (
      <button {...props}>{children}</button>
    ),
  },
}));

const mockWatch: ClassWatchRow = {
  id: 'watch-123',
  user_id: 'user-123',
  term: '2241',
  subject: 'CSE',
  catalog_nbr: '110',
  class_nbr: '12345',
  created_at: new Date().toISOString(),
};

const mockClassState: ClassStateRow = {
  id: 'state-123',
  term: '2241',
  subject: 'CSE',
  catalog_nbr: '110',
  class_nbr: '12345',
  seats_available: 5,
  seats_capacity: 30,
  non_reserved_seats: null,
  consecutive_not_found_count: 0,
  title: 'Introduction to Programming',
  instructor_name: 'Dr. Smith',
  location: 'TBD',
  meeting_times: 'MWF 10:00-11:00',
  last_checked_at: new Date().toISOString(),
  last_changed_at: new Date().toISOString(),
};

describe('ClassWatchCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateWatch.mockResolvedValue(mockWatch);
  });

  describe('delete functionality', () => {
    it('should reset isDeleting state after successful delete', async () => {
      const user = userEvent.setup();
      let resolveDelete: () => void;
      const deletePromise = new Promise<void>((resolve) => {
        resolveDelete = resolve;
      });

      const onDelete = vi.fn().mockReturnValue(deletePromise);

      render(<ClassWatchCard watch={mockWatch} classState={mockClassState} onDelete={onDelete} />);

      const deleteButton = screen.getByRole('button', {
        name: /stop watching/i,
      });
      await user.click(deleteButton);

      const confirmButton = screen.getByRole('button', { name: /stop watching/i });

      await act(async () => {
        await user.click(confirmButton);
      });

      expect(onDelete).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveDelete();
        await deletePromise;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const deleteButtons = screen.queryAllByRole('button', {
        name: /stop watching/i,
      });

      for (const button of deleteButtons) {
        expect(button).not.toBeDisabled();
      }
    });

    it('should reset isDeleting state after failed delete', async () => {
      const user = userEvent.setup();
      let rejectDelete: (error: Error) => void;
      const deletePromise = new Promise<void>((_, reject) => {
        rejectDelete = reject;
      });

      const onDelete = vi.fn().mockReturnValue(deletePromise);

      render(<ClassWatchCard watch={mockWatch} classState={mockClassState} onDelete={onDelete} />);

      const deleteButton = screen.getByRole('button', {
        name: /stop watching/i,
      });
      await user.click(deleteButton);

      const confirmButton = screen.getByRole('button', { name: /stop watching/i });

      await act(async () => {
        await user.click(confirmButton);
      });

      await act(async () => {
        rejectDelete(new Error('Delete failed'));
        try {
          await deletePromise;
        } catch {}
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const dialogDeleteButton = screen.getByRole('button', { name: /stop watching/i });
      await waitFor(() => {
        expect(dialogDeleteButton).not.toBeDisabled();
      });
    });

    it('restores a deleted watch through the shared creation module', async () => {
      const user = userEvent.setup();
      const onRestore = vi.fn();

      render(
        <ClassWatchCard
          watch={mockWatch}
          classState={mockClassState}
          onDelete={vi.fn().mockResolvedValue(undefined)}
          onRestore={onRestore}
        />
      );

      await user.click(screen.getByRole('button', { name: /stop watching/i }));
      await user.click(screen.getByRole('button', { name: /stop watching/i }));

      const removedToast = mockToastSuccess.mock.calls.find(
        ([message]) => message === 'Class watch removed'
      );
      await removedToast?.[1].action.onClick();

      expect(mockCreateWatch).toHaveBeenCalledWith({ term: '2241', class_nbr: '12345' });
      expect(mockToastSuccess).toHaveBeenCalledWith('Class watch restored');
      expect(onRestore).toHaveBeenCalledOnce();
    });
  });

  describe('swipe-to-delete', () => {
    it('keeps the slide-out open after a swipe-left delete instead of snapping back', async () => {
      vi.useFakeTimers();
      try {
        const onDelete = vi.fn().mockResolvedValue(undefined);
        render(
          <ClassWatchCard watch={mockWatch} classState={mockClassState} onDelete={onDelete} />
        );

        const handlers = () =>
          motionDivProps.current as {
            onTouchStart: (e: React.TouchEvent) => void;
            onTouchMove: (e: React.TouchEvent) => void;
            onTouchEnd: () => void;
          };

        act(() => {
          // eslint-disable-next-line anti-slop/no-chained-type-assertions
          handlers().onTouchStart({ touches: [{ clientX: 200 }] } as unknown as React.TouchEvent);
        });
        act(() => {
          // eslint-disable-next-line anti-slop/no-chained-type-assertions
          handlers().onTouchMove({ touches: [{ clientX: 80 }] } as unknown as React.TouchEvent);
        });
        act(() => {
          handlers().onTouchEnd();
        });

        expect((motionDivProps.current.animate as { x: number }).x).toBe(-500);

        await act(async () => {
          vi.advanceTimersByTime(300);
        });
        expect(onDelete).toHaveBeenCalledWith('watch-123');
        expect((motionDivProps.current.animate as { x: number }).x).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
