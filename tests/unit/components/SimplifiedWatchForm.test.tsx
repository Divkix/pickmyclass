import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { SimplifiedWatchForm } from '@/components/SimplifiedWatchForm';

describe('SimplifiedWatchForm', () => {
  let onSubmit: ReturnType<
    typeof vi.fn<(data: { term: string; class_nbr: string }) => Promise<void>>
  >;

  beforeEach(() => {
    vi.clearAllMocks();
    onSubmit = vi.fn().mockResolvedValue(undefined);
  });

  it('renders the term and class number inputs', () => {
    render(<SimplifiedWatchForm onSubmit={onSubmit} />);

    expect(screen.getByLabelText(/term/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/class number/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Watching' })).toBeDisabled();
  });

  it('rejects a class number that is not exactly 5 digits and does not call onSubmit', async () => {
    render(<SimplifiedWatchForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/class number/i), { target: { value: '1234' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Start Watching' }).closest('form')!);

    expect(await screen.findByText(/must be exactly 5 digits/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits term + class_nbr when valid and clears no error', async () => {
    render(<SimplifiedWatchForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/class number/i), { target: { value: '12345' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Start Watching' }).closest('form')!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ class_nbr: '12345' }));
  });

  it('surfaces the error message thrown by onSubmit', async () => {
    onSubmit.mockRejectedValue(new Error('Class section not found'));

    render(<SimplifiedWatchForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/class number/i), { target: { value: '99999' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Start Watching' }).closest('form')!);

    expect(await screen.findByText('Class section not found')).toBeInTheDocument();
  });

  it('shows the no-terms message and disables submission when no terms are selectable', async () => {
    vi.resetModules();
    vi.doMock('@/lib/asu/terms', () => ({
      getSelectableTerms: () => [],
      formatTermOption: () => '',
    }));
    const { SimplifiedWatchForm: NoTermsForm } = await import('@/components/SimplifiedWatchForm');

    render(<NoTermsForm onSubmit={onSubmit} />);

    expect(screen.getByText(/No terms are currently available/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Watching' })).toBeDisabled();
    vi.doUnmock('@/lib/asu/terms');
  });
});
