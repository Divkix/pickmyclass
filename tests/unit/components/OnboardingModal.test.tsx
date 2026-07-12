import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { OnboardingModal, type OnboardingState } from '@/components/OnboardingModal';
import type { ClassWatchRow } from '@/lib/types/class-watch';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}));

// Mock Radix Dialog portal so content renders in the jsdom document body.
vi.mock('@/components/ui/dialog', async () => {
  const actual =
    await vi.importActual<typeof import('@/components/ui/dialog')>('@/components/ui/dialog');
  return {
    ...actual,
    DialogPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const skippedState: OnboardingState = {
  onboarding_completed_at: null,
  onboarding_skipped_at: '2026-07-11T12:00:00Z',
  needs_onboarding: false,
};

const createdWatch: ClassWatchRow = {
  id: 'watch-1',
  user_id: 'user-1',
  term: '2267',
  class_nbr: '12345',
  subject: 'CSE',
  catalog_nbr: '110',
  created_at: '2026-07-11T12:00:00Z',
  updated_at: '2026-07-11T12:00:00Z',
} as ClassWatchRow;

describe('OnboardingModal', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...skippedState }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('renders the welcome (step 1) content when open', () => {
    render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

    expect(screen.getByText('Welcome to PickMyClass')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /I have my class number/i })).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    render(<OnboardingModal open={false} onSkipped={vi.fn()} />);

    expect(screen.queryByText('Welcome to PickMyClass')).not.toBeInTheDocument();
  });

  it('skips onboarding via the Skip for now button on step 1 and calls onSkipped', async () => {
    const user = userEvent.setup();
    const onSkipped = vi.fn();

    render(<OnboardingModal open={true} onSkipped={onSkipped} />);

    await user.click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/user/onboarding', { method: 'POST' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(onSkipped).toHaveBeenCalledWith(skippedState);
    });
  });

  it('skips onboarding when the Escape key is pressed on step 1', async () => {
    const onSkipped = vi.fn();
    render(<OnboardingModal open={true} onSkipped={onSkipped} />);

    fireEvent.keyDown(screen.getByText('Welcome to PickMyClass'), { key: 'Escape' });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/user/onboarding', { method: 'POST' });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(onSkipped).toHaveBeenCalledWith(skippedState);
    });
  });

  it('skips onboarding when the backdrop is clicked on step 1', async () => {
    const user = userEvent.setup();
    const onSkipped = vi.fn();
    render(<OnboardingModal open={true} onSkipped={onSkipped} />);

    const overlay = document.querySelector('[class*="bg-black/80"]') as HTMLElement;
    expect(overlay).toBeTruthy();
    await user.click(overlay);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/user/onboarding', { method: 'POST' });
    });
    // Radix fires both onPointerDownOutside and onInteractOutside for one
    // backdrop click; the ref guard must keep this to a single POST.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(onSkipped).toHaveBeenCalledWith(skippedState);
    });
  });

  it('calls onSkipError and does not call onSkipped when the skip request fails', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'boom' }),
    });
    const onSkipped = vi.fn();
    const onSkipError = vi.fn();

    render(<OnboardingModal open={true} onSkipped={onSkipped} onSkipError={onSkipError} />);

    await user.click(screen.getByRole('button', { name: 'Skip for now' }));

    await waitFor(() => {
      expect(onSkipError).toHaveBeenCalledWith('boom');
    });
    expect(onSkipped).not.toHaveBeenCalled();
  });

  describe('3-step watch-creation flow', () => {
    it('advances from step 1 to step 2 via the Next button', async () => {
      const user = userEvent.setup();
      render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /I have my class number/i }));

      expect(screen.getByText('Add your first class')).toBeInTheDocument();
      expect(screen.getByLabelText(/term/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/class number/i)).toBeInTheDocument();
    });

    it('returns to step 1 from step 2 via the Back button', async () => {
      const user = userEvent.setup();
      render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /I have my class number/i }));
      await user.click(screen.getByRole('button', { name: 'Back' }));

      expect(screen.getByText('Welcome to PickMyClass')).toBeInTheDocument();
    });

    it('creates a watch, advances to the confirmation step, and calls onCompleted on close', async () => {
      const user = userEvent.setup();
      const onCompleted = vi.fn();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ watch: createdWatch }),
      });

      render(<OnboardingModal open={true} onSkipped={vi.fn()} onCompleted={onCompleted} />);

      // Step 1 -> Step 2
      await user.click(screen.getByRole('button', { name: /I have my class number/i }));

      // Fill the simplified form
      const classNbrInput = screen.getByLabelText(/class number/i);
      await user.type(classNbrInput, '12345');

      // Term select is a Radix Select; the default term is pre-selected, so the
      // submit button is enabled once the class number is entered.
      await user.click(screen.getByRole('button', { name: 'Add class' }));

      // Step 3 confirmation
      expect(await screen.findByText("You're all set!")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/class-watches',
        expect.objectContaining({ method: 'POST' })
      );

      // Closing the confirmation calls onCompleted with the new watch.
      await user.click(screen.getByRole('button', { name: /Done/i }));
      expect(onCompleted).toHaveBeenCalledWith(createdWatch);
    });

    it('calls onCompleted only once even if Done is clicked twice', async () => {
      const user = userEvent.setup();
      const onCompleted = vi.fn();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ watch: createdWatch }),
      });

      render(<OnboardingModal open={true} onSkipped={vi.fn()} onCompleted={onCompleted} />);

      await user.click(screen.getByRole('button', { name: /I have my class number/i }));
      await user.type(screen.getByLabelText(/class number/i), '12345');
      await user.click(screen.getByRole('button', { name: 'Add class' }));
      expect(await screen.findByText("You're all set!")).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /Done/i }));
      await user.click(screen.getByRole('button', { name: /Done/i }));

      expect(onCompleted).toHaveBeenCalledTimes(1);
    });

    it('shows the form error and stays on step 2 when watch creation fails', async () => {
      const user = userEvent.setup();
      const onCompleted = vi.fn();

      fetchMock.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Class section not found' }),
      });

      render(<OnboardingModal open={true} onSkipped={vi.fn()} onCompleted={onCompleted} />);

      await user.click(screen.getByRole('button', { name: /I have my class number/i }));
      await user.type(screen.getByLabelText(/class number/i), '99999');
      await user.click(screen.getByRole('button', { name: 'Add class' }));

      expect(await screen.findByText('Class section not found')).toBeInTheDocument();
      expect(screen.getByText('Add your first class')).toBeInTheDocument();
      expect(onCompleted).not.toHaveBeenCalled();
    });

    it('marks completion on backdrop / Escape from the confirmation step without skipping', async () => {
      const user = userEvent.setup();
      const onCompleted = vi.fn();
      const onSkipped = vi.fn();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ watch: createdWatch }),
      });

      render(<OnboardingModal open={true} onSkipped={onSkipped} onCompleted={onCompleted} />);

      await user.click(screen.getByRole('button', { name: /I have my class number/i }));
      await user.type(screen.getByLabelText(/class number/i), '12345');
      await user.click(screen.getByRole('button', { name: 'Add class' }));
      expect(await screen.findByText("You're all set!")).toBeInTheDocument();

      // A skip POST must not fire from the confirmation step.
      const skipCalls = fetchMock.mock.calls.filter(
        ([url]) => url === '/api/user/onboarding'
      ).length;

      fireEvent.keyDown(screen.getByText("You're all set!"), { key: 'Escape' });

      await waitFor(() => {
        expect(onCompleted).toHaveBeenCalledWith(createdWatch);
      });
      expect(onSkipped).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/user/onboarding').length).toBe(
        skipCalls
      );
    });
  });
});
