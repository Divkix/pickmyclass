import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RecentActivity } from '@/components/admin/RecentActivity';
import type { RecentActivityItem } from '@/lib/db/admin-queries';

const mockItems: RecentActivityItem[] = [
  {
    type: 'user_registration',
    activityAt: '2026-05-19T10:00:00Z',
    userEmail: 'alice@example.com',
    classNbr: null,
    subject: null,
    catalogNbr: null,
    notificationType: null,
  },
  {
    type: 'new_watch',
    activityAt: '2026-05-19T09:30:00Z',
    userEmail: 'bob@example.com',
    classNbr: '12431',
    subject: 'CSE',
    catalogNbr: '240',
    notificationType: null,
  },
  {
    type: 'email_sent',
    activityAt: '2026-05-19T09:00:00Z',
    userEmail: 'charlie@example.com',
    classNbr: '12431',
    subject: 'CSE',
    catalogNbr: '240',
    notificationType: 'seat_available',
  },
  {
    type: 'email_sent',
    activityAt: '2026-05-19T08:00:00Z',
    userEmail: 'diana@example.com',
    classNbr: '12431',
    subject: 'CSE',
    catalogNbr: '240',
    notificationType: 'instructor_assigned',
  },
];

describe('RecentActivity', () => {
  it('renders all activity items with correct descriptions', () => {
    render(<RecentActivity items={mockItems} />);

    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    expect(screen.getByText('charlie@example.com')).toBeInTheDocument();
    expect(screen.getByText('diana@example.com')).toBeInTheDocument();
  });

  it('renders ISO time elements with UTC tooltip for each item', () => {
    render(<RecentActivity items={mockItems} />);

    const times = screen.getAllByRole('time');
    expect(times).toHaveLength(4);

    expect(times[0]).toHaveAttribute('dateTime', '2026-05-19T10:00:00Z');
    expect(times[0]).toHaveAttribute('title', expect.stringMatching(/GMT|UTC/));
  });

  it('renders empty state when no items provided', () => {
    render(<RecentActivity items={[]} />);

    expect(screen.getByText(/no recent activity/i)).toBeInTheDocument();
  });

  it('renders class and subject info for watch items', () => {
    render(<RecentActivity items={mockItems} />);

    expect(screen.getByText(/CSE 240/i)).toBeInTheDocument();
    // Match the watch-specific section format: "(section 12431)" not email's "for section 12431"
    expect(screen.getByText(/\(section 12431\)/)).toBeInTheDocument();
  });

  it('renders notification type labels for email items', () => {
    render(<RecentActivity items={mockItems} />);

    expect(screen.getByText(/seat available/i)).toBeInTheDocument();
    expect(screen.getByText(/instructor assigned/i)).toBeInTheDocument();
  });
});
