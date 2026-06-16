'use client';

import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { UserSortField } from '@/lib/db/admin-queries';
import type { UserWithWatchCount } from '@/lib/db/admin-queries';
import { formatRelativeDate } from '@/lib/utils/time-format';
import { SortableHeader } from './SortableHeader';
import { UsersTableFiltersComponent } from './UsersTableFilters';

interface UsersTableProps {
  users: UserWithWatchCount[];
  total: number;
  page: number;
  pageSize: number;
  sort: UserSortField;
  dir: 'asc' | 'desc';
  search: string;
  role: 'all' | 'admin' | 'user';
  verified: 'all' | 'verified' | 'unverified';
  watchCount: 'all' | 'none' | '1-5' | '6-10' | '10+';
}

/**
 * Format date to readable format with relative time
 */
function formatDate(dateString: string | null): string {
  if (!dateString) return 'Never';

  const relative = formatRelativeDate(dateString);
  if (relative) return relative;

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
 * Server-driven client component: sort, search, and filter all update URL
 * searchParams so the server re-queries.  Renders only the server-provided
 * page of rows — the full dataset is never in the browser.
 */
export function UsersTable({
  users,
  total,
  page,
  pageSize,
  sort,
  dir,
  search,
  role,
  verified,
  watchCount,
}: UsersTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  /** Build a new URL with updated searchParam(s) */
  const buildUrl = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === '' || v === 'all') {
          params.delete(k);
        } else {
          params.set(k, v);
        }
      }
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams]
  );

  const navigate = useCallback(
    (updates: Record<string, string>) => {
      startTransition(() => {
        router.push(buildUrl(updates));
      });
    },
    [router, buildUrl]
  );

  /** URL-driven sort handler — passed to SortableHeader as toggleSort */
  const handleSortClick = (field: UserSortField) => {
    if (sort === field) {
      navigate({ sort: field, dir: dir === 'asc' ? 'desc' : 'asc', page: '1' });
    } else {
      navigate({ sort: field, dir: 'asc', page: '1' });
    }
  };

  /** Icon renderer that reads URL state rather than hook-internal state */
  const renderSortIconFromUrl = (field: UserSortField) => {
    const { ChevronDown, ChevronUp, ChevronsUpDown } =
      require('lucide-react') as typeof import('lucide-react');
    if (sort !== field) return <ChevronsUpDown className="size-4 ml-1 text-muted-foreground" />;
    if (dir === 'asc') return <ChevronUp className="size-4 ml-1" />;
    return <ChevronDown className="size-4 ml-1" />;
  };

  const handleRowClick = (userId: string, event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.tagName === 'A' || target.closest('a')) return;
    router.push(`/admin/users/${userId}`);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      {/* Filters */}
      <UsersTableFiltersComponent
        search={search}
        role={role}
        verified={verified}
        watchCount={watchCount}
        onNavigate={(updates) => navigate({ ...updates, page: '1' })}
      />

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader
                field="email"
                label="Email"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="left"
                className="w-[300px]"
              />
              <SortableHeader
                field="created_at"
                label="Registered"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="left"
              />
              <SortableHeader
                field="last_sign_in_at"
                label="Last Sign In"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="left"
              />
              <TableHead>Email Verified</TableHead>
              <SortableHeader
                field="watch_count"
                label="Watches"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="center"
                className="text-center"
              />
              <SortableHeader
                field="seat_emails"
                label="Seat Emails"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="center"
                className="text-center"
              />
              <SortableHeader
                field="instructor_emails"
                label="Instructor Emails"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="center"
                className="text-center"
              />
              <SortableHeader
                field="engagement_rate"
                label="Engagement"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="center"
                className="text-center"
              />
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => {
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

      {/* Results count + pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total === 0 ? (
            'No users found'
          ) : (
            <>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}{' '}
              users
            </>
          )}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => navigate({ page: String(page - 1) })}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => navigate({ page: String(page + 1) })}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
