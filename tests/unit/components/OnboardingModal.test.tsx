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

const { mockTrack, mockCreateWatch } = vi.hoisted(() => ({
  mockTrack: vi.fn(),
  mockCreateWatch: vi.fn(),
}));

vi.mock('@/lib/analytics/client', () => ({
  trackAnalyticsEvent: mockTrack,
}));

vi.mock('@/lib/class-watches/class-watch-creation', () => ({
  classWatchCreation: {
    create: mockCreateWatch,
    getOptions: () => ({
      terms: [{ code: '2267', label: 'Fall 2026' }],
      defaultTerm: '2267',
    }),
  },
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

// SAFETY: test constructs minimal ClassWatchRow shape; only asserted fields are accessed by component under test
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
const popularClassPayload = {
  class_nbr: '12345',
  term: '2267',
  details: {
    subject: 'CSE',
    catalog_nbr: '240',
    title: 'Intro to Programming',
    instructor_name: 'John Doe',
    seats_available: 10,
    seats_capacity: 50,
  },
};

type PopularClassResponse = { popularClass?: typeof popularClassPayload | null };

describe('OnboardingModal', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  // Configurable responses per endpoint so `mockResolvedValueOnce` ordering
  // (broken by the open-time popular-class GET) doesn't bleed across tests.
  let popularClassResponse: PopularClassResponse;
  let skipResponse: Partial<OnboardingState> & { error?: string };
  let skipOk: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    popularClassResponse = { popularClass: null };
    mockCreateWatch.mockResolvedValue(createdWatch);
    skipResponse = { ...skippedState };
    skipOk = true;
    fetchMock = vi.fn((url: string) => {
      if (url === '/api/onboarding/popular-class') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(popularClassResponse),
        });
      }
      // /api/user/onboarding (skip POST)
      return Promise.resolve({
        ok: skipOk,
        json: () => Promise.resolve(skipResponse),
      });
    });
    // SAFETY: test double for global fetch; mock shape matches fetch contract for routes under test
    global.fetch = fetchMock as typeof fetch;
  });

  // SAFETY: narrowing mock call args to RequestInit to inspect method in filter helper
  const skipPostCalls = () =>
    fetchMock.mock.calls.filter(
      ([url, init]) => url === '/api/user/onboarding' && (init as RequestInit)?.method === 'POST'
    ).length;

  it('renders the welcome (step 1) content when open', async () => {
    render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Welcome to PickMyClass')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /I have my class number/i })).toBeInTheDocument();
  });

  it('captures onboarding_started when the modal opens', async () => {
    render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

    await waitFor(() => {
      expect(mockTrack).toHaveBeenCalledWith('onboarding_started', {});
    });
  });

  it('announces the current step for screen readers via a live region', async () => {
    render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

    const liveRegion = await screen.findByText('Step 1 of 3: Welcome to PickMyClass');
    expect(liveRegion).toHaveClass('sr-only');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
  });

  it('moves focus to the step title when the modal opens', async () => {
    render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

    const title = screen.getByRole('heading', { name: 'Welcome to PickMyClass' });
    await waitFor(() => {
      expect(document.activeElement).toBe(title);
    });
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
    expect(skipPostCalls()).toBe(1);
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
    expect(skipPostCalls()).toBe(1);
    await waitFor(() => {
      expect(onSkipped).toHaveBeenCalledWith(skippedState);
    });
  });

  it('skips onboarding when the backdrop is clicked on step 1', async () => {
    const user = userEvent.setup();
    const onSkipped = vi.fn();
    render(<OnboardingModal open={true} onSkipped={onSkipped} />);

    // SAFETY: test queries Radix overlay element; selector targets known backdrop class
    const overlay = document.querySelector('[class*="bg-black/80"]') as HTMLElement;
    await user.click(overlay);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/user/onboarding', { method: 'POST' });
    });
    // Radix fires both onPointerDownOutside and onInteractOutside for one
    // backdrop click; the ref guard must keep this to a single POST.
    expect(skipPostCalls()).toBe(1);
    await waitFor(() => {
      expect(onSkipped).toHaveBeenCalledWith(skippedState);
    });
  });

  it('calls onSkipError and does not call onSkipped when the skip request fails', async () => {
    const user = userEvent.setup();
    skipOk = false;
    skipResponse = { error: 'boom' };
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
      expect(mockCreateWatch).toHaveBeenCalledWith({ term: '2267', class_nbr: '12345' });

      // Closing the confirmation calls onCompleted with the new watch.
      await user.click(screen.getByRole('button', { name: /Done/i }));
      expect(onCompleted).toHaveBeenCalledWith(createdWatch);
    });

    it('captures onboarding_completed exactly once when a watch is created', async () => {
      const user = userEvent.setup();
      render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /I have my class number/i }));
      await user.type(screen.getByLabelText(/class number/i), '12345');
      await user.click(screen.getByRole('button', { name: 'Add class' }));

      await waitFor(() => {
        expect(mockTrack).toHaveBeenCalledWith('onboarding_completed', {});
      });
      const completedCalls = mockTrack.mock.calls.filter(
        (args) => args[0] === 'onboarding_completed'
      );
      expect(completedCalls).toHaveLength(1);
    });

    it('moves focus to the new step title when advancing between steps', async () => {
      const user = userEvent.setup();
      render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /I have my class number/i }));

      const title = await screen.findByRole('heading', { name: 'Add your first class' });
      await waitFor(() => {
        expect(document.activeElement).toBe(title);
      });
    });

    it('announces the new step when advancing between steps', async () => {
      const user = userEvent.setup();
      render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /I have my class number/i }));

      await waitFor(() => {
        expect(screen.getByText('Step 2 of 3: Add your first class')).toBeInTheDocument();
      });
    });

    it('keeps focus inside the modal while tabbing', async () => {
      const user = userEvent.setup();
      popularClassResponse = { popularClass: popularClassPayload };

      render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

      const dialog = await screen.findByRole('dialog');
      await waitFor(() => {
        expect(document.activeElement).toBeTruthy();
      });

      // Tab through all focusable elements and assert focus never leaves the dialog.
      for (let i = 0; i < 12; i++) {
        await user.tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
      }
    });

    it('calls onCompleted only once even if Done is clicked twice', async () => {
      const user = userEvent.setup();
      const onCompleted = vi.fn();

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

      mockCreateWatch.mockRejectedValueOnce(new Error('Class section not found'));

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

  describe('popular-class example', () => {
    it('shows the text-only guide (ASU catalog link) when no popular class is available', async () => {
      popularClassResponse = { popularClass: null };

      render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

      // The catalog link is the fallback guide's anchor.
      expect(await screen.findByText('ASU Class Search page')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Track this class/i })).not.toBeInTheDocument();
    });

    it('shows the text-only guide when the popular-class fetch fails', async () => {
      // fetch rejects for the popular-class endpoint; the modal catches and
      // falls back to the guide.
      fetchMock.mockImplementation((url: string) => {
        if (url === '/api/onboarding/popular-class') {
          return Promise.reject(new Error('network'));
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(skipResponse) });
      });

      render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

      expect(await screen.findByText('ASU Class Search page')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Track this class/i })).not.toBeInTheDocument();
    });

    it('shows the popular class card with a Track this class button when loaded', async () => {
      popularClassResponse = { popularClass: popularClassPayload };

      render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

      expect(await screen.findByText('CSE 240')).toBeInTheDocument();
      expect(screen.getByText('Intro to Programming')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Track this class/i })).toBeInTheDocument();
    });
    it('copies the example class number into the form and advances to step 2', async () => {
      const user = userEvent.setup();
      popularClassResponse = { popularClass: popularClassPayload };

      render(<OnboardingModal open={true} onSkipped={vi.fn()} />);

      await user.click(await screen.findByRole('button', { name: /Track this class/i }));

      expect(screen.getByText('Add your first class')).toBeInTheDocument();
      // SAFETY: getByLabelText returns HTMLElement known to be input; narrowing to HTMLInputElement for value assertion
      const classNbrInput = screen.getByLabelText(/class number/i) as HTMLInputElement;
      expect(classNbrInput).toHaveValue('12345');
    });
  });
});
