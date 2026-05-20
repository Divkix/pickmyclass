import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassesTable } from '@/components/admin/ClassesTable';
import type { ClassesTableFilters } from '@/components/admin/ClassesTableFilters';
import { UsersTable } from '@/components/admin/UsersTable';
import type { UsersTableFilters } from '@/components/admin/UsersTableFilters';
import type { ClassWithWatchers, UserWithWatchCount } from '@/lib/db/admin-queries';

const { mockPush } = vi.hoisted(() => ({
  mockPush: vi.fn(),
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
}));

const defaultClassFilters: ClassesTableFilters = {
  search: '',
  subject: 'all',
  seatStatus: 'all',
  instructor: 'all',
  watcherCount: 'all',
};

const defaultUserFilters: UsersTableFilters = {
  search: '',
  role: 'all',
  verified: 'all',
  watchCount: 'all',
};

vi.mock('@/components/admin/ClassesTableFilters', () => ({
  ClassesTableFiltersComponent: ({
    onFiltersChange,
  }: {
    onFiltersChange: (filters: ClassesTableFilters) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultClassFilters, search: 'zzzz' })}
      >
        class search miss
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultClassFilters, subject: 'MAT' })}
      >
        subject mat
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultClassFilters, seatStatus: 'full' })}
      >
        seats full
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultClassFilters, seatStatus: 'limited' })}
      >
        seats limited
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultClassFilters, seatStatus: 'available' })}
      >
        seats available
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultClassFilters, instructor: 'staff' })}
      >
        instructor staff
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultClassFilters, instructor: 'named' })}
      >
        instructor named
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultClassFilters, watcherCount: 'none' })}
      >
        watchers none
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultClassFilters, watcherCount: '1-5' })}
      >
        watchers one five
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultClassFilters, watcherCount: '6-10' })}
      >
        watchers six ten
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultClassFilters, watcherCount: '10+' })}
      >
        watchers ten plus
      </button>
    </div>
  ),
}));

vi.mock('@/components/admin/UsersTableFilters', () => ({
  UsersTableFiltersComponent: ({
    onFiltersChange,
  }: {
    onFiltersChange: (filters: UsersTableFilters) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultUserFilters, search: 'missing' })}
      >
        user search miss
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultUserFilters, role: 'admin' })}
      >
        role admin
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultUserFilters, role: 'user' })}
      >
        role user
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultUserFilters, verified: 'verified' })}
      >
        verified only
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultUserFilters, verified: 'unverified' })}
      >
        unverified only
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultUserFilters, watchCount: 'none' })}
      >
        user watchers none
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultUserFilters, watchCount: '1-5' })}
      >
        user watchers one five
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultUserFilters, watchCount: '6-10' })}
      >
        user watchers six ten
      </button>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...defaultUserFilters, watchCount: '10+' })}
      >
        user watchers ten plus
      </button>
    </div>
  ),
}));

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
  {
    id: 'class-3',
    class_nbr: '34567',
    term: '2261',
    subject: 'BIO',
    catalog_nbr: '181',
    title: null,
    instructor_name: null,
    seats_available: 2,
    seats_capacity: 100,
    non_reserved_seats: 1,
    location: 'Downtown',
    meeting_times: 'TTH',
    last_checked_at: '2026-05-17T00:00:00Z',
    last_changed_at: '2026-05-17T00:00:00Z',
    watcher_count: 8,
    seat_emails: 5,
    instructor_emails: 2,
  },
  {
    id: 'class-4',
    class_nbr: '45678',
    term: '2261',
    subject: 'PHY',
    catalog_nbr: '121',
    title: 'University Physics',
    instructor_name: 'Dr. Ray',
    seats_available: 40,
    seats_capacity: 100,
    non_reserved_seats: 30,
    location: 'Poly',
    meeting_times: 'MW',
    last_checked_at: '2026-05-16T00:00:00Z',
    last_changed_at: '2026-05-16T00:00:00Z',
    watcher_count: 12,
    seat_emails: 9,
    instructor_emails: 4,
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
    engagement_emails_sent: 0,
    engagement_emails_opened: 0,
    engagement_rate: null,
    engagement_status: 'new',
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
    engagement_emails_sent: 10,
    engagement_emails_opened: 1,
    engagement_rate: 10,
    engagement_status: 'low',
  },
  {
    id: 'user-2',
    email: 'disabled@example.com',
    created_at: '2026-04-01T00:00:00Z',
    last_sign_in_at: '2026-04-02T00:00:00Z',
    email_confirmed_at: '2026-04-01T00:00:00Z',
    watch_count: 8,
    is_admin: false,
    seat_emails: 8,
    instructor_emails: 2,
    engagement_emails_sent: 8,
    engagement_emails_opened: 0,
    engagement_rate: 0,
    engagement_status: 'disabled',
  },
  {
    id: 'user-3',
    email: 'healthy@example.com',
    created_at: '2026-03-01T00:00:00Z',
    last_sign_in_at: '2026-05-10T00:00:00Z',
    email_confirmed_at: '2026-03-02T00:00:00Z',
    watch_count: 15,
    is_admin: false,
    seat_emails: 12,
    instructor_emails: 6,
    engagement_emails_sent: 20,
    engagement_emails_opened: 18,
    engagement_rate: 90,
    engagement_status: 'healthy',
  },
];

describe('admin table components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty classes state', () => {
    render(<ClassesTable classes={[]} />);

    expect(screen.getByText('No classes found')).toBeInTheDocument();
  });

  it('filters, sorts, and navigates class rows', () => {
    render(<ClassesTable classes={classes} />);

    expect(screen.getByText('Showing 4 of 4 classes')).toBeInTheDocument();

    for (const header of [
      'Class #',
      'Subject',
      'Seats',
      'Watchers',
      'Seat Emails',
      'Instructor Emails',
      'Last Check',
    ]) {
      fireEvent.click(screen.getByText(header));
    }

    fireEvent.click(screen.getByText('subject mat'));
    expect(screen.getByText('Calculus I')).toBeInTheDocument();
    fireEvent.click(screen.getByText('seats full'));
    expect(screen.getByText('Calculus I')).toBeInTheDocument();
    fireEvent.click(screen.getByText('seats limited'));
    expect(screen.getByText('BIO')).toBeInTheDocument();
    fireEvent.click(screen.getByText('seats available'));
    expect(screen.getByText('University Physics')).toBeInTheDocument();
    fireEvent.click(screen.getByText('instructor staff'));
    expect(screen.getAllByText('Staff').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('instructor named'));
    expect(screen.getByText('Dr. Smith')).toBeInTheDocument();
    fireEvent.click(screen.getByText('watchers none'));
    expect(screen.getByText('Calculus I')).toBeInTheDocument();
    fireEvent.click(screen.getByText('watchers one five'));
    expect(screen.getByText('Intro to Programming')).toBeInTheDocument();
    fireEvent.click(screen.getByText('watchers six ten'));
    expect(screen.getByText('BIO')).toBeInTheDocument();
    fireEvent.click(screen.getByText('watchers ten plus'));
    expect(screen.getByText('University Physics')).toBeInTheDocument();
    fireEvent.click(screen.getByText('class search miss'));
    expect(screen.getByText('No classes match the selected filters')).toBeInTheDocument();

    fireEvent.click(screen.getByText('class search miss'));
    fireEvent.click(screen.getByText('subject mat'));
    fireEvent.click(screen.getByText('Calculus I').closest('tr') as HTMLTableRowElement);
    expect(mockPush).toHaveBeenCalledWith('/admin/classes/23456');
  });

  it('filters, sorts, and navigates user rows', () => {
    render(<UsersTable users={users} />);

    expect(screen.getByText('Showing 4 of 4 users')).toBeInTheDocument();

    for (const header of [
      'Email',
      'Registered',
      'Last Sign In',
      'Watches',
      'Seat Emails',
      'Instructor Emails',
      'Engagement',
    ]) {
      fireEvent.click(screen.getByText(header));
    }

    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Low Engagement')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();

    fireEvent.click(screen.getByText('role admin'));
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByText('role user'));
    expect(screen.getByText('student@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByText('verified only'));
    expect(screen.getByText('healthy@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByText('unverified only'));
    expect(screen.getByText('student@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByText('user watchers none'));
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByText('user watchers one five'));
    expect(screen.getByText('student@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByText('user watchers six ten'));
    expect(screen.getByText('disabled@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByText('user watchers ten plus'));
    expect(screen.getByText('healthy@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByText('user search miss'));
    expect(screen.getByText('No users found')).toBeInTheDocument();

    fireEvent.click(screen.getByText('role user'));
    fireEvent.click(screen.getByText('student@example.com').closest('tr') as HTMLTableRowElement);
    expect(mockPush).toHaveBeenCalledWith('/admin/users/user-1');

    mockPush.mockClear();
    fireEvent.click(screen.getByText('student@example.com'));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
