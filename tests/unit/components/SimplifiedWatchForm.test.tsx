import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { SimplifiedWatchForm } from '@/components/SimplifiedWatchForm';
import type { ClassWatchCreationInput } from '@/lib/class-watches/class-watch-creation';
import type { ClassWatchRow } from '@/lib/types/class-watch';

const { mockCreateWatch, mockGetOptions } = vi.hoisted(() => ({
  mockCreateWatch: vi.fn(),
  mockGetOptions: vi.fn(),
}));

vi.mock('@/lib/class-watches/class-watch-creation', () => ({
  classWatchCreation: {
    create: mockCreateWatch,
    getOptions: mockGetOptions,
  },
}));

describe('SimplifiedWatchForm', () => {
  let onCreated: ReturnType<
    typeof vi.fn<(watch: ClassWatchRow, input: ClassWatchCreationInput) => Promise<void>>
  >;

  beforeEach(() => {
    vi.clearAllMocks();
    onCreated = vi.fn().mockResolvedValue(undefined);
    mockCreateWatch.mockResolvedValue({ id: 'watch-1' } as ClassWatchRow);
    mockGetOptions.mockReturnValue({
      terms: [{ code: '2264', label: 'Summer 2026' }],
      defaultTerm: '2264',
    });
  });

  it('renders the term and class number inputs', () => {
    render(<SimplifiedWatchForm onCreated={onCreated} />);

    expect(screen.getByLabelText(/term/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/class number/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Watching' })).toBeDisabled();
  });

  it('submits through the creation module and reports the created watch', async () => {
    render(<SimplifiedWatchForm onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/class number/i), { target: { value: '12345' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Start Watching' }).closest('form')!);

    await waitFor(() => {
      expect(mockCreateWatch).toHaveBeenCalledWith({ term: '2264', class_nbr: '12345' });
      expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'watch-1' }), {
        term: '2264',
        class_nbr: '12345',
      });
    });
  });

  it('surfaces the error message thrown by the creation module', async () => {
    mockCreateWatch.mockRejectedValue(new Error('Class section not found'));

    render(<SimplifiedWatchForm onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/class number/i), { target: { value: '99999' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Start Watching' }).closest('form')!);

    expect(await screen.findByText('Class section not found')).toBeInTheDocument();
  });

  it('reports the complete creation lifecycle to its container', async () => {
    let resolveCreate!: (watch: ClassWatchRow) => void;
    mockCreateWatch.mockReturnValue(
      new Promise<ClassWatchRow>((resolve) => {
        resolveCreate = resolve;
      })
    );
    const onSubmittingChange = vi.fn();

    render(<SimplifiedWatchForm onCreated={onCreated} onSubmittingChange={onSubmittingChange} />);
    fireEvent.change(screen.getByLabelText(/class number/i), { target: { value: '12345' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Start Watching' }).closest('form')!);

    expect(onSubmittingChange).toHaveBeenCalledWith(true);
    resolveCreate({ id: 'watch-1' } as ClassWatchRow);
    await waitFor(() => expect(onSubmittingChange).toHaveBeenLastCalledWith(false));
  });

  it('shows the no-terms message and disables submission when no terms are selectable', () => {
    mockGetOptions.mockReturnValue({ terms: [], defaultTerm: '' });

    render(<SimplifiedWatchForm onCreated={onCreated} />);

    expect(screen.getByText(/No terms are currently available/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Watching' })).toBeDisabled();
  });
});
