import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { OnboardingModal, type OnboardingState } from '@/components/OnboardingModal';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
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

  it('renders the welcome content when open', () => {
    render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

    expect(screen.getByText('Welcome to PickMyClass')).toBeInTheDocument();
    expect(screen.getByText(/Add your first class/)).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    render(<OnboardingModal open={false} onSkipped={vi.fn()} />);

    expect(screen.queryByText('Welcome to PickMyClass')).not.toBeInTheDocument();
  });

  it('skips onboarding via the Skip for now button and calls onSkipped', async () => {
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

  it('skips onboarding when the Escape key is pressed', async () => {
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

  it('skips onboarding when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onSkipped = vi.fn();
    render(<OnboardingModal open={true} onSkipped={onSkipped} />);

    // The overlay is the element with the bg-black/80 backdrop (DialogOverlay).
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
});
