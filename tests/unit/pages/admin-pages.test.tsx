import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminClassDetailPage from '@/app/admin/classes/[classNbr]/page';
import AdminClassesPage from '@/app/admin/classes/page';
import AdminLayout from '@/app/admin/layout';
import AdminDashboardPage from '@/app/admin/page';
import AdminUserDetailPage from '@/app/admin/users/[userId]/page';
import AdminUsersPage from '@/app/admin/users/page';

const {
  mockGetAdminCount,
  mockGetAllClassesWithWatchers,
  mockGetAllUsersWithWatchCount,
  mockGetClassWatchers,
  mockGetRecentActivity,
  mockGetServiceClient,
  mockGetTotalClassesWatched,
  mockGetTotalEmailsSent,
  mockGetTotalUsers,
  mockGetUserWatches,
  mockPush,
  mockVerifyAdmin,
} = vi.hoisted(() => ({
  mockGetAdminCount: vi.fn(),
  mockGetAllClassesWithWatchers: vi.fn(),
  mockGetAllUsersWithWatchCount: vi.fn(),
  mockGetClassWatchers: vi.fn(),
  mockGetRecentActivity: vi.fn(),
  mockGetServiceClient: vi.fn(),
  mockGetTotalClassesWatched: vi.fn(),
  mockGetTotalEmailsSent: vi.fn(),
  mockGetTotalUsers: vi.fn(),
  mockGetUserWatches: vi.fn(),
  mockPush: vi.fn(),
  mockVerifyAdmin: vi.fn(),
}));

type LinkHref = string | { pathname?: string };
type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: LinkHref;
  children: ReactNode;
};

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: LinkProps) => (
    <a href={typeof href === 'string' ? href : (href.pathname ?? '#')} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found');
  }),
  usePathname: () => '/admin/classes',
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
  }),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'light',
    setTheme: vi.fn(),
  }),
}));

vi.mock('framer-motion', () => ({
  motion: createMotionElements(),
  m: createMotionElements(),
}));

vi.mock('@/lib/auth/admin', () => ({
  verifyAdmin: mockVerifyAdmin,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() =>
          Promise.resolve({ data: { user: { email: 'admin@example.com' } }, error: null })
        ),
      },
    })
  ),
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: mockGetServiceClient,
}));

vi.mock('@/lib/db/admin-queries', () => ({
  getAdminCount: mockGetAdminCount,
  getAllClassesWithWatchers: mockGetAllClassesWithWatchers,
  getAllUsersWithWatchCount: mockGetAllUsersWithWatchCount,
  getRecentActivity: mockGetRecentActivity,
  getTotalClassesWatched: mockGetTotalClassesWatched,
  getTotalEmailsSent: mockGetTotalEmailsSent,
  getTotalUsers: mockGetTotalUsers,
  getUserWatches: mockGetUserWatches,
}));

vi.mock('@/lib/db/queries', () => ({
  getClassWatchers: mockGetClassWatchers,
}));

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  } as unknown as typeof ResizeObserver;
});

function createMotionElements() {
  const MotionElement = ({
    as: Component,
    children,
    ...props
  }: { as: 'div' | 'button'; children?: ReactNode } & Record<string, unknown>) => {
    const {
      initial: _initial,
      animate: _animate,
      transition: _transition,
      whileHover: _whileHover,
      whileTap: _whileTap,
      variants: _variants,
      ...domProps
    } = props;

    return <Component {...domProps}>{children}</Component>;
  };

  return {
    div: (props: { children?: ReactNode } & Record<string, unknown>) => (
      <MotionElement as="div" {...props} />
    ),
    button: (props: { children?: ReactNode } & Record<string, unknown>) => (
      <MotionElement as="button" {...props} />
    ),
  };
}

const classRows = [
  {
    id: 'state-1',
    class_nbr: '12345',
    term: '2261',
    subject: 'CSE',
    catalog_nbr: '240',
    title: 'Intro to Programming',
    instructor_name: 'Dr. Smith',
    seats_available: 5,
    seats_capacity: 40,
    non_reserved_seats: 2,
    location: 'Tempe',
    meeting_times: 'MWF',
    last_checked_at: '2026-05-19T12:00:00Z',
    last_changed_at: '2026-05-19T12:00:00Z',
    watcher_count: 3,
    seat_emails: 2,
    instructor_emails: 1,
  },
  {
    id: 'state-2',
    class_nbr: '67890',
    term: '2261',
    subject: 'MAT',
    catalog_nbr: '265',
    title: 'Calculus I',
    instructor_name: 'Staff',
    seats_available: 0,
    seats_capacity: 80,
    non_reserved_seats: null,
    location: 'Online',
    meeting_times: 'TTH',
    last_checked_at: '2026-05-18T12:00:00Z',
    last_changed_at: '2026-05-18T12:00:00Z',
    watcher_count: 12,
    seat_emails: 8,
    instructor_emails: 0,
  },
];

const userRows = [
  {
    id: 'user-1',
    email: 'admin@example.com',
    created_at: '2026-05-01T00:00:00Z',
    last_sign_in_at: '2026-05-19T00:00:00Z',
    email_confirmed_at: '2026-05-02T00:00:00Z',
    watch_count: 3,
    is_admin: true,
    seat_emails: 4,
    instructor_emails: 1,
    engagement_emails_sent: 5,
    engagement_emails_opened: 3,
    engagement_rate: 60,
    engagement_status: 'healthy' as const,
  },
  {
    id: 'user-2',
    email: 'student@example.com',
    created_at: '2026-05-03T00:00:00Z',
    last_sign_in_at: null,
    email_confirmed_at: null,
    watch_count: 0,
    is_admin: false,
    seat_emails: 0,
    instructor_emails: 0,
    engagement_emails_sent: 0,
    engagement_emails_opened: 0,
    engagement_rate: null,
    engagement_status: 'new' as const,
  },
];

describe('admin pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyAdmin.mockResolvedValue({ email: 'admin@example.com' });
    mockGetTotalEmailsSent.mockResolvedValue(11);
    mockGetTotalUsers.mockResolvedValue(68);
    mockGetTotalClassesWatched.mockResolvedValue(14);
    mockGetAdminCount.mockResolvedValue(1);
    mockGetRecentActivity.mockResolvedValue([
      {
        type: 'email_sent',
        activityAt: '2026-05-19T12:00:00Z',
        userEmail: 'student@example.com',
        classNbr: '12345',
        subject: 'CSE',
        catalogNbr: '240',
        notificationType: 'seat_available',
      },
    ]);
    mockGetAllClassesWithWatchers.mockResolvedValue(classRows);
    mockGetAllUsersWithWatchCount.mockResolvedValue(userRows);
    mockGetClassWatchers.mockResolvedValue([
      {
        watch_id: 'watch-1',
        user_id: 'user-2',
        email: 'student@example.com',
        created_at: '2026-05-10T00:00:00Z',
      },
    ]);
    mockGetUserWatches.mockResolvedValue([
      {
        id: 'watch-1',
        user_id: 'user-1',
        term: '2261',
        subject: 'CSE',
        catalog_nbr: '240',
        class_nbr: '12345',
        created_at: '2026-05-10T00:00:00Z',
        class_state: classRows[0],
      },
    ]);
    mockGetServiceClient.mockReturnValue({
      auth: {
        admin: {
          getUserById: vi.fn(() =>
            Promise.resolve({
              data: { user: userRows[0] },
              error: null,
            })
          ),
        },
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({ data: classRows[0], error: null })),
          })),
        })),
      })),
    });
  });

  it('renders the admin layout shell and dashboard metrics with recent activity', async () => {
    render(await AdminLayout({ children: await AdminDashboardPage() }));

    expect(screen.getByRole('heading', { name: /admin dashboard/i })).toBeInTheDocument();
    expect(screen.getByText('Total Emails Sent')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(screen.getByText('student@example.com')).toBeInTheDocument();
    expect(screen.getByText(/seat available/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /classes/i }).length).toBeGreaterThan(0);
  });

  it('renders class tables and supports row navigation/sorting controls', async () => {
    render(await AdminClassesPage());

    expect(screen.getByRole('heading', { name: /all classes/i })).toBeInTheDocument();
    expect(screen.getByText('Intro to Programming')).toBeInTheDocument();
    expect(screen.getByText('Calculus I')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Class #'));
    fireEvent.click(screen.getByText('67890').closest('tr') as HTMLTableRowElement);
    expect(mockPush).toHaveBeenCalledWith('/admin/classes/67890');
  });

  it('renders class detail pages with class metadata and watchers', async () => {
    render(await AdminClassDetailPage({ params: Promise.resolve({ classNbr: '12345' }) }));

    expect(screen.getByRole('heading', { name: /cse 240/i })).toBeInTheDocument();
    expect(screen.getByText('Class Information')).toBeInTheDocument();
    expect(screen.getByText('student@example.com')).toBeInTheDocument();
    expect(screen.getByText('12345')).toBeInTheDocument();
  });

  it('renders user tables and supports row navigation/sorting controls', async () => {
    render(await AdminUsersPage());

    expect(screen.getByRole('heading', { name: /users/i })).toBeInTheDocument();
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText('student@example.com')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Email'));
    fireEvent.click(screen.getByText('student@example.com').closest('tr') as HTMLTableRowElement);
    expect(mockPush).toHaveBeenCalledWith('/admin/users/user-2');
  });

  it('renders user detail pages with profile and class watch data', async () => {
    render(await AdminUserDetailPage({ params: Promise.resolve({ userId: 'user-1' }) }));

    expect(screen.getByRole('heading', { name: /user details/i })).toBeInTheDocument();
    expect(screen.getByText('User Information')).toBeInTheDocument();
    expect(screen.getAllByText('admin@example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('Intro to Programming')).toBeInTheDocument();
  });
});
