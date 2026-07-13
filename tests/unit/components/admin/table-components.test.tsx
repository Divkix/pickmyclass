/**
 * Admin table component tests
 *
 * Since filtering and sorting are now server-driven (URL searchParams → RPC),
 * these tests verify that:
 * 1. The tables render the server-provided rows with correct visual layout.
 * 2. Sort header clicks navigate to the correct URL (via router.push).
 * 3. Pagination controls render and navigate correctly.
 * 4. Row clicks navigate to detail pages.
 * 5. Empty states render correctly.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { SortableHeader } from '@/components/admin/SortableHeader';
import { ClassesTable } from '@/components/admin/ClassesTable';
import { UsersTable } from '@/components/admin/UsersTable';
import type { ClassWithWatchers, UserWithWatchCount } from '@/lib/db/admin-queries';

const { mockPush, mockSearchParams } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockSearchParams: new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
    ...props
  }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => '/admin/classes',
  useSearchParams: () => mockSearchParams,
}));

// Stub filter components — they just pass onNavigate calls through
vi.mock('@/components/admin/ClassesTableFilters', () => ({
  ClassesTableFiltersComponent: ({
    onNavigate,
  }: {
    onNavigate: (updates: Record<string, string>) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onNavigate({ search: 'zzzz' })}>
        class search miss
      </button>
      <button type="button" onClick={() => onNavigate({ subject: 'MAT' })}>
        subject mat
      </button>
    </div>
  ),
}));

vi.mock('@/components/admin/UsersTableFilters', () => ({
  UsersTableFiltersComponent: ({
    onNavigate,
  }: {
    onNavigate: (updates: Record<string, string>) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onNavigate({ search: 'missing' })}>
        user search miss
      </button>
      <button type="button" onClick={() => onNavigate({ role: 'admin' })}>
        role admin
      </button>
    </div>
  ),
}));

const defaultClassProps = {
  total: 0,
  page: 1,
  pageSize: 25,
  subjects: ['CSE', 'MAT', 'BIO', 'PHY'],
  sort: 'watcher_count' as const,
  dir: 'desc' as const,
  search: '',
  subject: 'all',
  seatStatus: 'all' as const,
  instructor: 'all' as const,
  watcherCount: 'all' as const,
};

const defaultUserProps = {
  total: 0,
  page: 1,
  pageSize: 25,
  sort: 'created_at' as const,
  dir: 'desc' as const,
  search: '',
  role: 'all' as const,
  verified: 'all' as const,
  watchCount: 'all' as const,
};

const classes: ClassWithWatchers[] = [
  {
    id: 'class-1',
    class_nbr: '12345',
    term: '2261',
    subject: 'CSE',
    catalog_nbr: '240',
    title: 'Intro to Programming',
    instructor_name: 'Dr. Smith',
    seats_available: 25,
    seats_capacity: 100,
    non_reserved_seats: 20,
    location: 'Tempe',
    meeting_times: 'MWF',
    last_checked_at: new Date(Date.now() - 60_000).toISOString(),
    last_changed_at: new Date(Date.now() - 60_000).toISOString(),
    watcher_count: 3,
    seat_emails: 2,
    instructor_emails: 1,
  },
  {
    id: 'class-2',
    class_nbr: '23456',
    term: '2261',
    subject: 'MAT',
    catalog_nbr: '265',
    title: 'Calculus I',
    instructor_name: 'Staff',
    seats_available: 0,
    seats_capacity: 80,
    non_reserved_seats: 0,
    location: null,
    meeting_times: null,
    last_checked_at: new Date(Date.now() - 86_400_000).toISOString(),
    last_changed_at: new Date(Date.now() - 86_400_000).toISOString(),
    watcher_count: 0,
    seat_emails: 0,
    instructor_emails: 0,
  },
];

const users: UserWithWatchCount[] = [
  {
    id: 'admin-1',
    email: 'admin@example.com',
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
    last_sign_in_at: new Date(Date.now() - 60_000).toISOString(),
    email_confirmed_at: '2026-05-02T00:00:00Z',
    watch_count: 0,
    is_admin: true,
    seat_emails: 0,
    instructor_emails: 0,
    notification_status: 'active',
  },
  {
    id: 'user-1',
    email: 'student@example.com',
    created_at: '2026-05-01T00:00:00Z',
    last_sign_in_at: null,
    email_confirmed_at: null,
    watch_count: 3,
    is_admin: false,
    seat_emails: 4,
    instructor_emails: 1,
    notification_status: 'bounced',
  },
];

describe('admin table components (server-driven)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── ClassesTable ──────────────────────────────────────────────────────────

  it('renders the empty classes state when no rows and no active filters', () => {
    render(<ClassesTable {...defaultClassProps} classes={[]} />);
    expect(screen.getByText('No classes found')).toBeInTheDocument();
  });

  it('renders provided class rows and shows correct count text', () => {
    render(<ClassesTable {...defaultClassProps} classes={classes} total={2} />);

    expect(screen.getByText('Intro to Programming')).toBeInTheDocument();
    expect(screen.getByText('Calculus I')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–2 of 2 classes')).toBeInTheDocument();
  });

  it('navigates to class detail page on row click', () => {
    render(<ClassesTable {...defaultClassProps} classes={classes} total={2} />);

    fireEvent.click(screen.getByText('Calculus I').closest('tr') as HTMLTableRowElement);
    expect(mockPush).toHaveBeenCalledWith('/admin/classes/2261/23456');
  });

  it('sort header clicks update URL searchParams', () => {
    render(<ClassesTable {...defaultClassProps} classes={classes} total={2} />);

    // Click 'Class #' header
    fireEvent.click(screen.getByText('Class #'));
    expect(mockPush).toHaveBeenCalled();
    const callArg: string = mockPush.mock.calls[0][0] as string;
    expect(callArg).toContain('sort=class_nbr');
  });

  it('shows no-results row when classes array is empty but filters are active', () => {
    render(<ClassesTable {...defaultClassProps} classes={[]} total={0} search="zzzz" />);
    // Text appears in both the empty-body <td> and the pagination count line (expected).
    const matches = screen.getAllByText('No classes match the selected filters');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]).toBeInTheDocument();
  });

  it('renders pagination controls when totalPages > 1', () => {
    render(
      <ClassesTable {...defaultClassProps} classes={classes} total={50} page={1} pageSize={25} />
    );
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('filter component onNavigate triggers router.push', () => {
    render(<ClassesTable {...defaultClassProps} classes={classes} total={2} />);

    fireEvent.click(screen.getByText('subject mat'));
    expect(mockPush).toHaveBeenCalled();
    const callArg: string = mockPush.mock.calls[0][0] as string;
    expect(callArg).toContain('subject=MAT');
  });

  // ── UsersTable ────────────────────────────────────────────────────────────

  it('renders provided user rows and shows correct count text', () => {
    render(<UsersTable {...defaultUserProps} users={users} total={2} />);

    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText('student@example.com')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–2 of 2 users')).toBeInTheDocument();
  });

  it('renders empty state when no users found', () => {
    render(<UsersTable {...defaultUserProps} users={[]} total={0} />);
    // Text appears in both the empty-body <td> and the pagination count line (expected).
    const matches = screen.getAllByText('No users found');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]).toBeInTheDocument();
  });

  it('navigates to user detail page on row click', () => {
    render(<UsersTable {...defaultUserProps} users={users} total={2} />);

    fireEvent.click(screen.getByText('student@example.com').closest('tr') as HTMLTableRowElement);
    expect(mockPush).toHaveBeenCalledWith('/admin/users/user-1');
  });

  it('does not navigate on email link click (stopPropagation)', () => {
    render(<UsersTable {...defaultUserProps} users={users} total={2} />);

    fireEvent.click(screen.getByText('student@example.com'));
    // router.push should NOT be called with /admin/users/user-1
    const calls = mockPush.mock.calls.filter((c: string[]) => c[0]?.includes('/admin/users/'));
    expect(calls.length).toBe(0);
  });

  it('sort header clicks update URL searchParams', () => {
    render(<UsersTable {...defaultUserProps} users={users} total={2} />);

    fireEvent.click(screen.getByText('Email'));
    expect(mockPush).toHaveBeenCalled();
    const callArg: string = mockPush.mock.calls[0][0] as string;
    expect(callArg).toContain('sort=email');
  });

  it('shows Admin badge for admin users', () => {
    render(<UsersTable {...defaultUserProps} users={users} total={2} />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('shows the notification delivery status', () => {
    render(<UsersTable {...defaultUserProps} users={users} total={2} />);
    expect(screen.getByText('Bounced')).toBeInTheDocument();
  });

  it('filter component onNavigate triggers router.push', () => {
    render(<UsersTable {...defaultUserProps} users={users} total={2} />);

    fireEvent.click(screen.getByText('role admin'));
    expect(mockPush).toHaveBeenCalled();
    const callArg: string = mockPush.mock.calls[0][0] as string;
    expect(callArg).toContain('role=admin');
  });

  it('renders pagination controls when totalPages > 1', () => {
    render(<UsersTable {...defaultUserProps} users={users} total={50} page={1} pageSize={25} />);
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  describe('SortableHeader', () => {
    it('calls toggleSort on click', () => {
      const toggleSort = vi.fn();
      const renderSortIcon = vi.fn(() => null);

      render(
        <table>
          <thead>
            <tr>
              <SortableHeader
                field="email"
                label="Email"
                toggleSort={toggleSort}
                renderSortIcon={renderSortIcon}
              />
            </tr>
          </thead>
        </table>
      );

      fireEvent.click(screen.getByText('Email'));
      expect(toggleSort).toHaveBeenCalledWith('email');
      expect(renderSortIcon).toHaveBeenCalledWith('email');
    });

    it('calls toggleSort on Enter keydown', () => {
      const toggleSort = vi.fn();
      const renderSortIcon = vi.fn(() => null);

      render(
        <table>
          <thead>
            <tr>
              <SortableHeader
                field="email"
                label="Email"
                toggleSort={toggleSort}
                renderSortIcon={renderSortIcon}
              />
            </tr>
          </thead>
        </table>
      );

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: 'Enter' });
      expect(toggleSort).toHaveBeenCalledWith('email');
    });

    it('calls toggleSort on Space keydown', () => {
      const toggleSort = vi.fn();
      const renderSortIcon = vi.fn(() => null);

      render(
        <table>
          <thead>
            <tr>
              <SortableHeader
                field="email"
                label="Email"
                toggleSort={toggleSort}
                renderSortIcon={renderSortIcon}
              />
            </tr>
          </thead>
        </table>
      );

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: ' ' });
      expect(toggleSort).toHaveBeenCalledWith('email');
    });

    it('does not call toggleSort on other keys', () => {
      const toggleSort = vi.fn();
      const renderSortIcon = vi.fn(() => null);

      render(
        <table>
          <thead>
            <tr>
              <SortableHeader
                field="email"
                label="Email"
                toggleSort={toggleSort}
                renderSortIcon={renderSortIcon}
              />
            </tr>
          </thead>
        </table>
      );

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: 'Tab' });
      expect(toggleSort).not.toHaveBeenCalled();
    });

    it('renders children icons and the sort icon', () => {
      const toggleSort = vi.fn();
      const renderSortIcon = vi.fn(() => <span data-testid="sort-icon" />);

      render(
        <table>
          <thead>
            <tr>
              <SortableHeader
                field="watcher_count"
                label="Watchers"
                toggleSort={toggleSort}
                renderSortIcon={renderSortIcon}
                align="center"
              >
                <span data-testid="col-icon" />
              </SortableHeader>
            </tr>
          </thead>
        </table>
      );

      expect(screen.getByTestId('col-icon')).toBeInTheDocument();
      expect(screen.getByTestId('sort-icon')).toBeInTheDocument();
      expect(screen.getByText('Watchers')).toBeInTheDocument();
    });
  });
});
