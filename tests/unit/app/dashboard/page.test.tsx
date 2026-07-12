import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import DashboardPage from '@/app/dashboard/page';

// Mock Next.js hooks
const mockReplace = vi.fn();
const mockRouter = {
  replace: mockReplace,
};

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  m: {
    div: ({ children, ...props }: { children: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
  motion: {
    div: ({ children, ...props }: { children: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
  fadeInUp: {},
  staggerContainer: {},
  staggerItem: {},
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Calendar: () => <span data-testid="calendar-icon">Calendar</span>,
  CheckCircle2: () => <span data-testid="check-icon">CheckCircle2</span>,
  Eye: () => <span data-testid="eye-icon">Eye</span>,
  Plus: () => <span data-testid="plus-icon">Plus</span>,
  Search: () => <span data-testid="search-icon">Search</span>,
  TrendingUp: () => <span data-testid="trending-icon">TrendingUp</span>,
  Users: () => <span data-testid="users-icon">Users</span>,
}));

// Mock Auth context
const mockUseAuth = vi.fn();

vi.mock('@/lib/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// Mock realtime hook
const mockUseRealtimeClassStates = vi.fn();
const mockRefetchClassStates = vi.fn();

vi.mock('@/lib/hooks/useRealtimeClassStates', () => ({
  useRealtimeClassStates: (opts: unknown) => mockUseRealtimeClassStates(opts),
}));

// Mock pull-to-refresh hook
let lastRefreshHandler: (() => Promise<void>) | null = null;

vi.mock('@/lib/hooks/usePullToRefresh', () => ({
  usePullToRefresh: (opts: { onRefresh: () => Promise<void> }) => {
    lastRefreshHandler = opts.onRefresh;
    return {
      pullDistance: 0,
      isRefreshing: false,
      containerRef: { current: null },
    };
  },
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock UI components
vi.mock('@/components/ui/alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="alert" role="alert">
      {children}
    </div>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton">Skeleton</div>,
}));

// Mock components
vi.mock('@/components/Header', () => ({
  Header: () => <header data-testid="header">Header</header>,
}));

vi.mock('@/components/PullToRefreshIndicator', () => ({
  PullToRefreshIndicator: () => <div data-testid="pull-indicator">PullToRefresh</div>,
}));

vi.mock('@/components/ClassWatchCard', () => ({
  ClassWatchCard: ({
    watch,
    classState,
    onDelete,
    onRestore,
  }: {
    watch: { id: string; class_nbr: string; subject?: string; catalog_nbr?: string };
    classState?: { title?: string } | null;
    onDelete: (watchId: string) => Promise<void>;
    onRestore: () => Promise<unknown>;
  }) => (
    <div data-testid="class-watch-card">
      <span>{watch.class_nbr}</span>
      <span>{watch.subject}</span>
      <span>{watch.catalog_nbr}</span>
      <span>{classState?.title}</span>
      <button type="button" onClick={() => void onDelete(watch.id).catch(() => undefined)}>
        Delete {watch.id}
      </button>
      <button type="button" onClick={() => void onRestore()}>
        Restore {watch.id}
      </button>
    </div>
  ),
}));

vi.mock('@/components/OnboardingModal', () => ({
  OnboardingModal: ({
    open,
    onCompleted,
  }: {
    open: boolean;
    onCompleted?: (watch: { id: string }) => void;
  }) => (
    <div
      data-testid="onboarding-modal"
      data-open={open ? 'true' : 'false'}
      data-on-completed={onCompleted ? 'true' : 'false'}
    >
      {onCompleted && (
        <button type="button" onClick={() => onCompleted({ id: 'watch-new' })}>
          Complete onboarding
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/components/FinishSetupCard', () => ({
  FinishSetupCard: () => <div data-testid="finish-setup-card" />,
}));

const makeWatch = (overrides: Record<string, unknown> = {}) => ({
  id: 'watch-1',
  user_id: 'user-1',
  term: '2267',
  class_nbr: '12345',
  subject: 'CSE',
  catalog_nbr: '110',
  created_at: '2026-05-19T00:00:00Z',
  updated_at: '2026-05-19T00:00:00Z',
  class_state: {
    class_nbr: '12345',
    term: '2267',
    title: 'Intro to Programming',
    instructor_name: 'Ada Lovelace',
    seats_available: 0,
    seats_total: 50,
    updated_at: '2026-05-19T00:00:00Z',
  },
  ...overrides,
});

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock: authenticated user
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'test@example.com' },
      loading: false,
    });

    // Default mock: successful realtime state
    mockUseRealtimeClassStates.mockReturnValue({
      classStates: {},
      loading: false,
      error: null,
      refetch: mockRefetchClassStates,
    });
    mockRefetchClassStates.mockResolvedValue(undefined);
    lastRefreshHandler = null;

    // Mock successful fetch response
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          watches: [],
          maxWatches: 10,
        }),
    });
  });

  describe('realtime error state display (issue #174)', () => {
    it('should display error alert when useRealtimeClassStates returns an error', async () => {
      // Mock the hook to return an error
      const testError = new Error('Failed to fetch class states from Supabase');
      mockUseRealtimeClassStates.mockReturnValue({
        classStates: {},
        loading: false,
        error: testError,
        refetch: mockRefetchClassStates,
      });

      // Mock successful watches fetch (so the page loads)
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            watches: [
              {
                ...makeWatch(),
              },
            ],
            maxWatches: 10,
          }),
      });

      render(<DashboardPage />);

      // Wait for the error alert to appear
      const errorAlert = await screen.findByTestId('alert');
      expect(errorAlert).toBeInTheDocument();
      expect(errorAlert).toHaveTextContent(/Failed to fetch class states/);
    });

    it('should not display error alert when useRealtimeClassStates has no error', async () => {
      // Mock the hook to return no error
      mockUseRealtimeClassStates.mockReturnValue({
        classStates: {
          '2267:12345': {
            class_nbr: '12345',
            term: '2267',
            seats_available: 5,
          },
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      // Mock successful watches fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            watches: [
              {
                ...makeWatch(),
              },
            ],
            maxWatches: 10,
          }),
      });

      render(<DashboardPage />);

      // Wait for content to load
      await screen.findByText('Your Class Watchlist');

      // There should be no alerts (neither fetch error nor realtime error)
      const alerts = screen.queryAllByTestId('alert');
      expect(alerts).toHaveLength(0);
    });
  });

  it('renders auth loading skeletons before the session check completes', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
    });

    render(<DashboardPage />);

    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getAllByTestId('skeleton')).toHaveLength(3);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated visitors to login', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
    });

    const { container } = render(<DashboardPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login');
    });
    expect(container).toBeEmptyDOMElement();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows the API error when class watches cannot be fetched', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    });

    render(<DashboardPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch class watches');
    await waitFor(() => {
      expect(screen.queryAllByTestId('skeleton')).toHaveLength(0);
    });
  });

  it('renders the empty watchlist state after a successful empty response', async () => {
    render(<DashboardPage />);

    expect(await screen.findByText('Your watchlist is empty')).toBeInTheDocument();
    expect(screen.getByText(/2,400\+/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add your first class/i })).toHaveAttribute(
      'href',
      '/dashboard/add'
    );
  });

  it('defaults missing watch payload fields to safe values', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    render(<DashboardPage />);

    expect(await screen.findByText('Your watchlist is empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add class/i })).toHaveAttribute(
      'href',
      '/dashboard/add'
    );
  });

  it('uses the fallback load error for non-Error fetch failures', async () => {
    global.fetch = vi.fn().mockRejectedValue('offline');

    render(<DashboardPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load class watches');
  });

  it('renders stats from persisted and live class states', async () => {
    mockUseRealtimeClassStates.mockReturnValue({
      classStates: {
        '2267:67890': {
          class_nbr: '67890',
          term: '2267',
          title: 'Discrete Math',
          instructor_name: 'Grace Hopper',
          seats_available: 3,
        },
      },
      loading: true,
      error: null,
      refetch: mockRefetchClassStates,
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          watches: [
            makeWatch(),
            makeWatch({
              id: 'watch-2',
              class_nbr: '67890',
              subject: 'MAT',
              catalog_nbr: '243',
              class_state: {
                class_nbr: '67890',
                term: '2267',
                title: 'Old Title',
                instructor_name: 'Old Instructor',
                seats_available: 0,
              },
            }),
          ],
          maxWatches: 5,
        }),
    });

    render(<DashboardPage />);

    expect(await screen.findByText('Total Watches')).toBeInTheDocument();
    expect(screen.getByText('3 remaining')).toBeInTheDocument();
    expect(screen.getByText('Go register now!')).toBeInTheDocument();
    expect(screen.getByText("We'll alert you when seats open")).toBeInTheDocument();
    expect(screen.getByText('Syncing...')).toBeInTheDocument();
    expect(screen.getByText('Discrete Math')).toBeInTheDocument();
  });

  it('filters watched classes with the search field and shows the no-result state', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          watches: [
            makeWatch(),
            makeWatch({
              id: 'watch-2',
              class_nbr: '67890',
              subject: 'MAT',
              catalog_nbr: '243',
              class_state: {
                class_nbr: '67890',
                term: '2267',
                title: 'Calculus III',
                instructor_name: 'Mary Jackson',
                seats_available: 0,
              },
            }),
          ],
          maxWatches: 10,
        }),
    });

    render(<DashboardPage />);

    expect(await screen.findAllByTestId('class-watch-card')).toHaveLength(2);

    fireEvent.change(screen.getByLabelText(/search watched classes/i), {
      target: { value: 'mary' },
    });
    expect(screen.getAllByTestId('class-watch-card')).toHaveLength(1);
    expect(screen.getByText('67890')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/search watched classes/i), {
      target: { value: 'no-match' },
    });
    expect(screen.getByText('No results found')).toBeInTheDocument();
    expect(screen.getByText('Try adjusting your search query')).toBeInTheDocument();
  });

  it('removes a deleted watch from local state', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            watches: [makeWatch(), makeWatch({ id: 'watch-2', class_nbr: '67890' })],
            maxWatches: 10,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

    render(<DashboardPage />);

    expect(await screen.findAllByTestId('class-watch-card')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /delete watch-1/i }));

    await waitFor(() => {
      expect(screen.getAllByTestId('class-watch-card')).toHaveLength(1);
    });
    expect(global.fetch).toHaveBeenLastCalledWith('/api/class-watches?id=watch-1', {
      method: 'DELETE',
    });
  });

  it('leaves a watch in place when deletion fails', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            watches: [makeWatch()],
            maxWatches: 10,
          }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      });

    render(<DashboardPage />);

    expect(await screen.findAllByTestId('class-watch-card')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /delete watch-1/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith('/api/class-watches?id=watch-1', {
        method: 'DELETE',
      });
    });
    expect(screen.getAllByTestId('class-watch-card')).toHaveLength(1);
  });

  it('uses pull-to-refresh success and error toasts', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            watches: [makeWatch()],
            maxWatches: 10,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            watches: [makeWatch(), makeWatch({ id: 'watch-2', class_nbr: '67890' })],
            maxWatches: 10,
          }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      });

    render(<DashboardPage />);
    expect(await screen.findByText('Total Watches')).toBeInTheDocument();

    await act(async () => {
      await lastRefreshHandler?.();
    });
    expect(mockRefetchClassStates).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringMatching(/^Dashboard refreshed at /),
      expect.objectContaining({ description: 'Updated 2 class watches' })
    );

    await act(async () => {
      await lastRefreshHandler?.();
    });
    expect(toast.error).toHaveBeenCalledWith(
      'Failed to refresh dashboard',
      expect.objectContaining({ description: 'Failed to fetch class watches' })
    );
  });

  it('uses singular refresh wording and fallback refresh errors', async () => {
    mockRefetchClassStates.mockRejectedValueOnce('realtime offline');
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            watches: [makeWatch()],
            maxWatches: 10,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            watches: [makeWatch()],
            maxWatches: 10,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            watches: [makeWatch()],
            maxWatches: 10,
          }),
      });

    render(<DashboardPage />);
    expect(await screen.findByText('Total Watches')).toBeInTheDocument();

    await act(async () => {
      await lastRefreshHandler?.();
    });
    expect(toast.error).toHaveBeenCalledWith(
      'Failed to refresh dashboard',
      expect.objectContaining({ description: 'Please try again' })
    );

    mockRefetchClassStates.mockResolvedValueOnce(undefined);
    await act(async () => {
      await lastRefreshHandler?.();
    });
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringMatching(/^Dashboard refreshed at /),
      expect.objectContaining({ description: 'Updated 1 class watch' })
    );
  });

  describe('onboarding (issue #298)', () => {
    it('renders the onboarding modal for a new user who has not completed or skipped', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            watches: [],
            maxWatches: 10,
            onboarding: {
              onboarding_completed_at: null,
              onboarding_skipped_at: null,
              needs_onboarding: true,
            },
          }),
      });

      render(<DashboardPage />);

      const modal = await screen.findByTestId('onboarding-modal');
      expect(modal).toHaveAttribute('data-open', 'true');
      expect(screen.queryByTestId('finish-setup-card')).not.toBeInTheDocument();
    });

    it('renders the finish-setup card after skipping and hides it once a watch exists', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            watches: [],
            maxWatches: 10,
            onboarding: {
              onboarding_completed_at: null,
              onboarding_skipped_at: '2026-07-11T12:00:00Z',
              needs_onboarding: false,
            },
          }),
      });

      render(<DashboardPage />);

      expect(await screen.findByTestId('finish-setup-card')).toBeInTheDocument();
      expect(screen.getByTestId('onboarding-modal')).toHaveAttribute('data-open', 'false');
    });

    it('does not render the modal or card for existing (completed) users', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            watches: [],
            maxWatches: 10,
            onboarding: {
              onboarding_completed_at: '2026-07-10T00:00:00Z',
              onboarding_skipped_at: null,
              needs_onboarding: false,
            },
          }),
      });

      render(<DashboardPage />);

      await screen.findByText('Your watchlist is empty');
      expect(screen.getByTestId('onboarding-modal')).toHaveAttribute('data-open', 'false');
      expect(screen.queryByTestId('finish-setup-card')).not.toBeInTheDocument();
    });

    it('hides the finish-setup card and adds the watch when a skipped user completes (issue #307)', async () => {
      // Simulates `handleOnboardingCompleted` firing after a skipped user
      // creates their first watch elsewhere (e.g. via /dashboard/add). The
      // mocked modal exposes a trigger so we can exercise the dashboard's
      // `completeOnFirstWatch` projection without a real modal interaction.
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            watches: [],
            maxWatches: 10,
            onboarding: {
              onboarding_completed_at: null,
              onboarding_skipped_at: '2026-07-11T12:00:00Z',
              needs_onboarding: false,
            },
          }),
      });

      render(<DashboardPage />);

      // Skipped user: card shown, modal closed.
      expect(await screen.findByTestId('finish-setup-card')).toBeInTheDocument();
      expect(screen.getByTestId('onboarding-modal')).toHaveAttribute('data-open', 'false');

      // The modal's completion handler fires (e.g. via the in-modal watch form).
      fireEvent.click(screen.getByRole('button', { name: 'Complete onboarding' }));

      // First watch appears locally and the finish-setup card is dropped.
      await waitFor(() => {
        expect(screen.queryByTestId('finish-setup-card')).not.toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /delete watch-new/i })).toBeInTheDocument();
    });
  });
});
