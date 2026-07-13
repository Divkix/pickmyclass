import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import AdminClassDetailPage from '@/app/admin/classes/[term]/[classNbr]/page';
import AdminClassesPage from '@/app/admin/classes/page';
import AdminLayout from '@/app/admin/layout';
import AdminDashboardPage from '@/app/admin/page';
import AdminUserDetailPage from '@/app/admin/users/[userId]/page';
import AdminUsersPage from '@/app/admin/users/page';

const {
  mockGetAdminCount,
  mockGetClassWatchers,
  mockGetClassesPage,
  mockGetDistinctSubjects,
  mockGetRecentActivity,
  mockGetServiceClient,
  mockGetTotalClassesWatched,
  mockGetTotalEmailsSent,
  mockGetTotalUsers,
  mockGetUserWatches,
  mockGetUsersPage,
  mockPush,
  mockVerifyAdmin,
} = vi.hoisted(() => ({
  mockGetAdminCount: vi.fn(),
  mockGetClassWatchers: vi.fn(),
  mockGetClassesPage: vi.fn(),
  mockGetDistinctSubjects: vi.fn(),
  mockGetRecentActivity: vi.fn(),
  mockGetServiceClient: vi.fn(),
  mockGetTotalClassesWatched: vi.fn(),
  mockGetTotalEmailsSent: vi.fn(),
  mockGetTotalUsers: vi.fn(),
  mockGetUserWatches: vi.fn(),
  mockGetUsersPage: vi.fn(),
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
  useSearchParams: () => new URLSearchParams(),
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
  getClassesPage: mockGetClassesPage,
  getDistinctSubjects: mockGetDistinctSubjects,
  getRecentActivity: mockGetRecentActivity,
  getTotalClassesWatched: mockGetTotalClassesWatched,
  getTotalEmailsSent: mockGetTotalEmailsSent,
  getTotalUsers: mockGetTotalUsers,
  getUserWatches: mockGetUserWatches,
  getUsersPage: mockGetUsersPage,
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

/**
 * class_states rows the service-client mock filters over. Reset to `classRows`
 * before each test; individual tests reassign it (e.g. the two-term case).
 */
let classStateFixtures: Array<Record<string, unknown>> = classRows;

/**
 * Minimal term-aware `class_states` query builder: records the `.eq` filters
 * applySectionRef applies and resolves `.single()` to the row matching BOTH
 * class_nbr and term — so a section number shared by two terms resolves to one
 * row instead of the real client's multi-row error.
 */
function makeClassStatesQuery() {
  const filters: Record<string, string> = {};
  const builder = {
    select: () => builder,
    eq: (column: string, value: string) => {
      filters[column] = value;
      return builder;
    },
    single: () => {
      const match = classStateFixtures.find(
        (row) => row.class_nbr === filters.class_nbr && row.term === filters.term
      );
      return Promise.resolve(
        match ? { data: match, error: null } : { data: null, error: { code: 'PGRST116' } }
      );
    },
  };
  return builder;
}

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
    notification_status: 'active' as const,
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
    notification_status: 'unsubscribed' as const,
  },
];

/** Default empty searchParams */
const emptySearchParams = Promise.resolve({} as Record<string, string | undefined>);

describe('admin pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    classStateFixtures = classRows;
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
    // New paginated functions
    mockGetUsersPage.mockResolvedValue({ rows: userRows, total: userRows.length });
    mockGetClassesPage.mockResolvedValue({ rows: classRows, total: classRows.length });
    mockGetDistinctSubjects.mockResolvedValue(['CSE', 'MAT']);
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
      from: vi.fn(() => makeClassStatesQuery()),
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

  it('renders class tables with paginated rows and supports row navigation/sorting controls', async () => {
    render(await AdminClassesPage({ searchParams: emptySearchParams }));

    expect(screen.getByRole('heading', { name: /all classes/i })).toBeInTheDocument();
    expect(screen.getByText('Intro to Programming')).toBeInTheDocument();
    expect(screen.getByText('Calculus I')).toBeInTheDocument();

    // Verify paginated query was called (not the whole-table function)
    expect(mockGetClassesPage).toHaveBeenCalled();
    expect(mockGetDistinctSubjects).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Class #'));
    fireEvent.click(screen.getByText('67890').closest('tr') as HTMLTableRowElement);
    expect(mockPush).toHaveBeenCalledWith('/admin/classes/2261/67890');
  });

  it('renders class detail pages with class metadata and watchers', async () => {
    render(
      await AdminClassDetailPage({ params: Promise.resolve({ term: '2261', classNbr: '12345' }) })
    );

    expect(screen.getByRole('heading', { name: /cse 240/i })).toBeInTheDocument();
    expect(screen.getByText('Class Information')).toBeInTheDocument();
    expect(screen.getByText('student@example.com')).toBeInTheDocument();
    expect(screen.getByText('12345')).toBeInTheDocument();
    // Watchers are scoped to the full SectionRef (class_nbr + term), not class_nbr alone.
    expect(mockGetClassWatchers).toHaveBeenCalledWith({ class_nbr: '12345', term: '2261' });
  });

  it('loads the requested term when a class number exists in two terms', async () => {
    // Same class_nbr in two terms with different seats/instructor — the route must
    // resolve the exact SectionRef, not trip .single()'s multi-row error (the #278 bug).
    classStateFixtures = [
      {
        ...classRows[0],
        id: 'state-fall',
        term: '2257',
        instructor_name: 'Professor Autumn',
        seats_available: 9,
        seats_capacity: 30,
      },
      {
        ...classRows[0],
        id: 'state-spring',
        term: '2261',
        instructor_name: 'Professor Vernal',
        seats_available: 2,
        seats_capacity: 30,
      },
    ];

    render(
      await AdminClassDetailPage({ params: Promise.resolve({ term: '2261', classNbr: '12345' }) })
    );

    // Shows the clicked term's data...
    expect(screen.getByText('Professor Vernal')).toBeInTheDocument();
    expect(screen.getByText('2/30 seats')).toBeInTheDocument();
    // ...and never the other term's.
    expect(screen.queryByText('Professor Autumn')).not.toBeInTheDocument();
    expect(screen.queryByText('9/30 seats')).not.toBeInTheDocument();
  });

  it('renders user tables with paginated rows and supports row navigation/sorting controls', async () => {
    render(await AdminUsersPage({ searchParams: emptySearchParams }));

    expect(screen.getByRole('heading', { name: /users/i })).toBeInTheDocument();
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText('student@example.com')).toBeInTheDocument();

    // Verify paginated query was called (not the whole-table function)
    expect(mockGetUsersPage).toHaveBeenCalled();

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

  it('passes page/sort/filter searchParams to getUsersPage', async () => {
    const sp = Promise.resolve({
      page: '2',
      sort: 'email',
      dir: 'asc',
      role: 'admin',
    } as Record<string, string | undefined>);

    await AdminUsersPage({ searchParams: sp });

    expect(mockGetUsersPage).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        sort: 'email',
        dir: 'asc',
        role: 'admin',
      })
    );
  });

  it('passes page/sort/filter searchParams to getClassesPage', async () => {
    const sp = Promise.resolve({
      page: '3',
      sort: 'class_nbr',
      dir: 'asc',
      subject: 'CSE',
      seatStatus: 'full',
    } as Record<string, string | undefined>);

    await AdminClassesPage({ searchParams: sp });

    expect(mockGetClassesPage).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 3,
        sort: 'class_nbr',
        dir: 'asc',
        subject: 'CSE',
        seatStatus: 'full',
      })
    );
  });

  it('falls back from an invalid class sort field', async () => {
    await AdminClassesPage({
      searchParams: Promise.resolve({ sort: 'DROP TABLE class_states' }),
    });

    expect(mockGetClassesPage).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'watcher_count' })
    );
  });
});
