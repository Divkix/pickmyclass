import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
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

      const deleteButton = screen.getByRole('button', { name: /delete/i });
      await user.click(deleteButton);

      expect(onConfirm).toHaveBeenCalledTimes(1);

      expect(onOpenChange).not.toHaveBeenCalled();

      await act(async () => {
        resolveDelete();
        await deletePromise;
      });

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

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(onConfirm).toHaveBeenCalledTimes(1);

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
