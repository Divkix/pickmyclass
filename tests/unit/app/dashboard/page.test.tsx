import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@/lib/hooks/useRealtimeClassStates', () => ({
  useRealtimeClassStates: (opts: unknown) => mockUseRealtimeClassStates(opts),
}));

// Mock pull-to-refresh hook
vi.mock('@/lib/hooks/usePullToRefresh', () => ({
  usePullToRefresh: () => ({
    pullDistance: 0,
    isRefreshing: false,
    containerRef: { current: null },
  }),
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
  ClassWatchCard: () => <div data-testid="class-watch-card">ClassWatchCard</div>,
}));

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
      refetch: vi.fn(),
    });

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
        refetch: vi.fn(),
      });

      // Mock successful watches fetch (so the page loads)
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            watches: [
              {
                id: 'watch-1',
                class_nbr: '12345',
                subject: 'CSE',
                catalog_nbr: '110',
                user_id: 'user-1',
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
          '12345': {
            class_nbr: '12345',
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
                id: 'watch-1',
                class_nbr: '12345',
                subject: 'CSE',
                catalog_nbr: '110',
                user_id: 'user-1',
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
});
