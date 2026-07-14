import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { ClassWatchCard } from '@/components/ClassWatchCard';
import type { ClassStateRow, ClassWatchRow } from '@/lib/types/class-watch';

const { mockCreateWatch, mockToastError, mockToastSuccess } = vi.hoisted(() => ({
  mockCreateWatch: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
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

// Mock framer-motion
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
    div: ({ children, ...props }: { children: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
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

      // Open delete dialog
      const deleteButton = screen.getByRole('button', {
        name: /stop watching/i,
      });
      await user.click(deleteButton);

      // Dialog should be open - click confirm
      const confirmButton = screen.getByRole('button', { name: /stop watching/i });

      // Click in act() since it triggers state changes
      await act(async () => {
        await user.click(confirmButton);
      });

      // onDelete should be called
      expect(onDelete).toHaveBeenCalledTimes(1);

      // Resolve the delete promise
      await act(async () => {
        resolveDelete();
        await deletePromise;
      });

      // Wait a bit for state updates
      await new Promise((resolve) => setTimeout(resolve, 10));

      // The delete button should be enabled again (isDeleting reset)
      // We verify this by checking the original button is not disabled
      const deleteButtons = screen.queryAllByRole('button', {
        name: /stop watching/i,
      });

      // If dialog is closed and card is still rendered, the button should be enabled
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

      // Open delete dialog
      const deleteButton = screen.getByRole('button', {
        name: /stop watching/i,
      });
      await user.click(deleteButton);

      // Click confirm
      const confirmButton = screen.getByRole('button', { name: /stop watching/i });

      await act(async () => {
        await user.click(confirmButton);
      });

      // Reject the delete promise
      await act(async () => {
        rejectDelete(new Error('Delete failed'));
        try {
          await deletePromise;
        } catch {
          // Expected
        }
      });

      // Wait for state updates
      await new Promise((resolve) => setTimeout(resolve, 10));

      // After error, the delete button in the dialog should be re-enabled
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
});
