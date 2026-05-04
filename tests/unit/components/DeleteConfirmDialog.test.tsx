import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';

describe('DeleteConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('async deletion handling', () => {
    it('should wait for async onConfirm to complete before closing dialog', async () => {
      const user = userEvent.setup();
      let resolveDelete: () => void;
      const deletePromise = new Promise<void>((resolve) => {
        resolveDelete = resolve;
      });

      const onConfirm = vi.fn().mockReturnValue(deletePromise);
      const onOpenChange = vi.fn();

      render(
        <DeleteConfirmDialog
          open={true}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
          title="Delete Item?"
          description="This will delete the item"
        />
      );

      // Click the delete button
      const deleteButton = screen.getByRole('button', { name: /delete/i });
      await user.click(deleteButton);

      // onConfirm should be called
      expect(onConfirm).toHaveBeenCalledTimes(1);

      // But onOpenChange should NOT be called yet (async operation pending)
      expect(onOpenChange).not.toHaveBeenCalled();

      // Now resolve the async operation
      await act(async () => {
        resolveDelete();
        await deletePromise;
      });

      // NOW onOpenChange should be called with false to close dialog
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should not close dialog if onConfirm throws error', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn().mockRejectedValue(new Error('Delete failed'));
      const onOpenChange = vi.fn();

      render(
        <DeleteConfirmDialog
          open={true}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
          title="Delete Item?"
          description="This will delete the item"
        />
      );

      const deleteButton = screen.getByRole('button', { name: /delete/i });

      await user.click(deleteButton);

      // Wait for async operation to complete (and fail)
      await act(async () => {
        // Give time for the promise to reject
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // onConfirm should be called
      expect(onConfirm).toHaveBeenCalledTimes(1);

      // Dialog should NOT close on error
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('should disable buttons while isDeleting is true', async () => {
      render(
        <DeleteConfirmDialog
          open={true}
          onOpenChange={vi.fn()}
          onConfirm={vi.fn()}
          title="Delete Item?"
          description="This will delete the item"
          isDeleting={true}
        />
      );

      const deleteButton = screen.getByRole('button', { name: /deleting/i });
      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      expect(deleteButton).toBeDisabled();
      expect(cancelButton).toBeDisabled();
    });

    it('should show "Deleting..." text while isDeleting is true', async () => {
      render(
        <DeleteConfirmDialog
          open={true}
          onOpenChange={vi.fn()}
          onConfirm={vi.fn()}
          title="Delete Item?"
          description="This will delete the item"
          isDeleting={true}
          confirmText="Remove"
        />
      );

      expect(screen.getByText('Deleting...')).toBeInTheDocument();
    });
  });
});
