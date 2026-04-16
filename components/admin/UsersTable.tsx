'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { UserWithWatchCount } from '@/lib/db/admin-queries';
import { formatRelativeDate } from '@/lib/utils/time-format';
import { type UsersTableFilters, UsersTableFiltersComponent } from './UsersTableFilters';
import { useTableSorting } from './useTableSorting';

interface UsersTableProps {
  users: UserWithWatchCount[];
}

type SortField =
  | 'email'
  | 'created_at'
  | 'last_sign_in_at'
  | 'watch_count'
  | 'seat_emails'
  | 'instructor_emails'
  | 'engagement_rate';

/**
 * Format date to readable format with relative time
 */
function formatDate(dateString: string | null): string {
  if (!dateString) return 'Never';

  const relative = formatRelativeDate(dateString);
  if (relative) return relative;

  // Otherwise show formatted date
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Admin Users Table Component
 *
 * Client component for displaying all users with filtering, sorting, and navigation support.
 * Features:
 * - Search by email
 * - Filter by role, verification status, watch count
 * - Sort by email, registration date, last sign in, watch count
 * - Click to navigate to user detail pages
 */
export function UsersTable({ users }: UsersTableProps) {
  const router = useRouter();

  // Filter state
  const [filters, setFilters] = useState<UsersTableFilters>({
    search: '',
    role: 'all',
    verified: 'all',
    watchCount: 'all',
  });

  const { sortField, sortDirection, toggleSort, renderSortIcon } = useTableSorting<SortField>();

  // Filtered and sorted users (memoized for performance)
  const filteredAndSortedUsers = useMemo(() => {
    let result = [...users];

    // Apply filters
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter((user) => user.email.toLowerCase().includes(searchLower));
    }

    if (filters.role !== 'all') {
      result = result.filter((user) => {
        if (filters.role === 'admin') return user.is_admin;
        if (filters.role === 'user') return !user.is_admin;
        return true;
      });
    }

    if (filters.verified !== 'all') {
      result = result.filter((user) => {
        const isVerified = !!user.email_confirmed_at;
        if (filters.verified === 'verified') return isVerified;
        if (filters.verified === 'unverified') return !isVerified;
        return true;
      });
    }

    if (filters.watchCount !== 'all') {
      result = result.filter((user) => {
        const count = user.watch_count;
        if (filters.watchCount === 'none') return count === 0;
        if (filters.watchCount === '1-5') return count >= 1 && count <= 5;
        if (filters.watchCount === '6-10') return count >= 6 && count <= 10;
        if (filters.watchCount === '10+') return count > 10;
        return true;
      });
    }

    // Apply sorting
    if (sortField && sortDirection) {
      result.sort((a, b) => {
        let aVal: string | number | null;
        let bVal: string | number | null;

        if (sortField === 'email') {
          aVal = a.email;
          bVal = b.email;
        } else if (sortField === 'created_at') {
          aVal = a.created_at;
          bVal = b.created_at;
        } else if (sortField === 'last_sign_in_at') {
          aVal = a.last_sign_in_at;
          bVal = b.last_sign_in_at;
        } else if (sortField === 'watch_count') {
          aVal = a.watch_count;
          bVal = b.watch_count;
        } else if (sortField === 'seat_emails') {
          aVal = a.seat_emails;
          bVal = b.seat_emails;
        } else if (sortField === 'instructor_emails') {
          aVal = a.instructor_emails;
          bVal = b.instructor_emails;
        } else if (sortField === 'engagement_rate') {
          aVal = a.engagement_rate;
          bVal = b.engagement_rate;
        } else {
          return 0;
        }

        // Handle null values (sort to end)
        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return 1;
        if (bVal === null) return -1;

        // Compare values
        let comparison = 0;
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          comparison = aVal.localeCompare(bVal);
        } else if (typeof aVal === 'number' && typeof bVal === 'number') {
          comparison = aVal - bVal;
        }

        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    return result;
  }, [users, filters, sortField, sortDirection]);

  const handleRowClick = (userId: string, event: React.MouseEvent) => {
    // Don't navigate if user clicked on the email link
    const target = event.target as HTMLElement;
    if (target.tagName === 'A' || target.closest('a')) {
      return;
    }

    router.push(`/admin/users/${userId}`);
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <UsersTableFiltersComponent filters={filters} onFiltersChange={setFilters} />

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="w-[300px] cursor-pointer select-none hover:bg-muted/50"
                onClick={() => toggleSort('email')}
              >
                <div className="flex items-center">
                  Email
                  {renderSortIcon('email')}
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer select-none hover:bg-muted/50"
                onClick={() => toggleSort('created_at')}
              >
                <div className="flex items-center">
                  Registered
                  {renderSortIcon('created_at')}
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer select-none hover:bg-muted/50"
                onClick={() => toggleSort('last_sign_in_at')}
              >
                <div className="flex items-center">
                  Last Sign In
                  {renderSortIcon('last_sign_in_at')}
                </div>
              </TableHead>
              <TableHead>Email Verified</TableHead>
              <TableHead
                className="text-center cursor-pointer select-none hover:bg-muted/50"
                onClick={() => toggleSort('watch_count')}
              >
                <div className="flex items-center justify-center">
                  Watches
                  {renderSortIcon('watch_count')}
                </div>
              </TableHead>
              <TableHead
                className="text-center cursor-pointer select-none hover:bg-muted/50"
                onClick={() => toggleSort('seat_emails')}
              >
                <div className="flex items-center justify-center">
                  Seat Emails
                  {renderSortIcon('seat_emails')}
                </div>
              </TableHead>
              <TableHead
                className="text-center cursor-pointer select-none hover:bg-muted/50"
                onClick={() => toggleSort('instructor_emails')}
              >
                <div className="flex items-center justify-center">
                  Instructor Emails
                  {renderSortIcon('instructor_emails')}
                </div>
              </TableHead>
              <TableHead
                className="text-center cursor-pointer select-none hover:bg-muted/50"
                onClick={() => toggleSort('engagement_rate')}
              >
                <div className="flex items-center justify-center">
                  Engagement
                  {renderSortIcon('engagement_rate')}
                </div>
              </TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSortedUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              filteredAndSortedUsers.map((user) => {
                const isVerified = !!user.email_confirmed_at;

                return (
                  <TableRow
                    key={user.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={(e) => handleRowClick(user.id, e)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/users/${user.id}`}
                          className="text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-sm"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {user.email}
                        </Link>
                        {user.is_admin && (
                          <Badge variant="destructive" className="text-xs">
                            Admin
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground text-sm">
                        {formatDate(user.created_at)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground text-sm">
                        {formatDate(user.last_sign_in_at)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={isVerified ? 'success' : 'warning'} size="sm">
                        {isVerified ? 'Verified' : 'Unverified'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="font-semibold text-foreground">{user.watch_count}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="font-semibold text-foreground">{user.seat_emails}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="font-semibold text-foreground">
                        {user.instructor_emails}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {user.engagement_status === 'new' ? (
                        <span className="text-muted-foreground text-sm">New</span>
                      ) : (
                        <span
                          className={`font-semibold ${
                            user.engagement_status === 'disabled'
                              ? 'text-destructive'
                              : user.engagement_status === 'low'
                                ? 'text-warning'
                                : 'text-foreground'
                          }`}
                        >
                          {user.engagement_rate !== null ? `${user.engagement_rate}%` : '-'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {user.engagement_status === 'disabled' ? (
                        <Badge variant="destructive" size="sm">
                          Disabled
                        </Badge>
                      ) : user.engagement_status === 'low' ? (
                        <Badge variant="warning" size="sm">
                          Low Engagement
                        </Badge>
                      ) : (
                        <Badge variant="default" size="sm">
                          Active
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Results count */}
      {filteredAndSortedUsers.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Showing {filteredAndSortedUsers.length} of {users.length} users
        </p>
      )}
    </div>
  );
}
