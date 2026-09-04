'use client';

import { ChevronDown, ChevronUp, ChevronsUpDown, Clock, Mail, Users } from 'lucide-react';
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
import type { ClassSortField } from '@/lib/db/admin-queries';
import type { ClassWithWatchers } from '@/lib/db/admin-queries';
import { getSeatBadgeVariant } from '@/lib/utils/seat-badge';
import { formatRelativeTime } from '@/lib/utils/time-format';
import { SortableHeader } from './SortableHeader';
import { ClassesTableFiltersComponent } from './ClassesTableFilters';

interface ClassesTableProps {
  classes: ClassWithWatchers[];
  total: number;
  page: number;
  pageSize: number;
  subjects: string[];
  sort: ClassSortField;
  dir: 'asc' | 'desc';
  search: string;
  subject: string;
  seatStatus: 'all' | 'full' | 'limited' | 'available';
  instructor: 'all' | 'staff' | 'named';
  watcherCount: 'all' | 'none' | '1-5' | '6-10' | '10+';
}

export function ClassesTable({
  classes,
  total,
  page,
  pageSize,
  subjects,
  sort,
  dir,
  search,
  subject,
  seatStatus,
  instructor,
  watcherCount,
}: ClassesTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

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

  const handleSortClick = (field: ClassSortField) => {
    if (sort === field) {
      navigate({ sort: field, dir: dir === 'asc' ? 'desc' : 'asc', page: '1' });
    } else {
      navigate({ sort: field, dir: 'asc', page: '1' });
    }
  };

  const renderSortIconFromUrl = (field: ClassSortField) => {
    if (sort !== field) return <ChevronsUpDown className="size-4 ml-1 text-muted-foreground" />;
    if (dir === 'asc') return <ChevronUp className="size-4 ml-1" />;
    return <ChevronDown className="size-4 ml-1" />;
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (
    total === 0 &&
    search === '' &&
    subject === 'all' &&
    seatStatus === 'all' &&
    instructor === 'all' &&
    watcherCount === 'all'
  ) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium mb-2">No classes found</p>
        <p className="text-sm">No classes are currently being watched by users</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ClassesTableFiltersComponent
        subjects={subjects}
        search={search}
        subject={subject}
        seatStatus={seatStatus}
        instructor={instructor}
        watcherCount={watcherCount}
        onNavigate={(updates) => navigate({ ...updates, page: '1' })}
      />

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader
                field="class_nbr"
                label="Class #"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="left"
                className="w-[100px]"
              />
              <SortableHeader
                field="subject"
                label="Subject"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="left"
                className="w-[120px]"
              />
              <TableHead>Title</TableHead>
              <TableHead>Instructor</TableHead>
              <SortableHeader
                field="seats_available"
                label="Seats"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="center"
                className="text-center w-[120px]"
              />
              <SortableHeader
                field="watcher_count"
                label="Watchers"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="center"
                className="text-center w-[100px]"
              >
                <Users className="size-4" />
              </SortableHeader>
              <SortableHeader
                field="seat_emails"
                label="Seat Emails"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="center"
                className="text-center w-[100px]"
              >
                <Mail className="size-4" />
              </SortableHeader>
              <SortableHeader
                field="instructor_emails"
                label="Instructor Emails"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="center"
                className="text-center w-[100px]"
              >
                <Users className="size-4" />
              </SortableHeader>
              <SortableHeader
                field="last_checked_at"
                label="Last Check"
                toggleSort={handleSortClick}
                renderSortIcon={renderSortIconFromUrl}
                align="right"
                className="text-right w-[120px]"
              >
                <Clock className="size-4" />
              </SortableHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {classes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No classes match the selected filters
                </TableCell>
              </TableRow>
            ) : (
              classes.map((classItem) => (
                <TableRow
                  key={classItem.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => {
                    router.push(`/admin/classes/${classItem.term}/${classItem.class_nbr}`);
                  }}
                >
                  <TableCell className="font-mono font-semibold">
                    <Link
                      href={`/admin/classes/${classItem.term}/${classItem.class_nbr}`}
                      className="text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {classItem.class_nbr}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{classItem.subject}</span>
                    <span className="text-muted-foreground ml-1">{classItem.catalog_nbr}</span>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[300px] truncate" title={classItem.title || ''}>
                      {classItem.title || '-'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[200px] truncate">
                      {classItem.instructor_name || 'Staff'}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={getSeatBadgeVariant(
                        classItem.seats_available,
                        classItem.seats_capacity
                      )}
                      size="sm"
                    >
                      {classItem.seats_available}/{classItem.seats_capacity}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" size="sm">
                      {classItem.watcher_count}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" size="sm">
                      {classItem.seat_emails}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" size="sm">
                      {classItem.instructor_emails}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {formatRelativeTime(classItem.last_checked_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total === 0 ? (
            'No classes match the selected filters'
          ) : (
            <>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}{' '}
              classes
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
