'use client';

import { Clock, Mail, Users } from 'lucide-react';
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
import type { ClassWithWatchers } from '@/lib/db/admin-queries';
import { getSeatBadgeVariant } from '@/lib/utils/seat-badge';
import { formatRelativeTime } from '@/lib/utils/time-format';
import { type ClassesTableFilters, ClassesTableFiltersComponent } from './ClassesTableFilters';
import { useTableSorting } from './useTableSorting';

interface ClassesTableProps {
  classes: ClassWithWatchers[];
}

type SortField =
  | 'class_nbr'
  | 'subject'
  | 'seats_available'
  | 'watcher_count'
  | 'seat_emails'
  | 'instructor_emails'
  | 'last_checked_at';

/**
 * Admin Classes Table Component
 *
 * Client Component that renders a table of all classes being watched.
 * Features:
 * - Search by class number or title
 * - Filter by subject, seat status, instructor type, watcher count
 * - Sort by class number, subject, seats available, watcher count, last check
 * - Click to navigate to class detail pages
 *
 * @param classes - Array of classes with watcher counts
 */
export function ClassesTable({ classes }: ClassesTableProps) {
  const router = useRouter();

  const uniqueSubjects = useMemo(() => {
    const subjects = new Set(classes.map((c) => c.subject));
    return Array.from(subjects).sort();
  }, [classes]);
  const [filters, setFilters] = useState<ClassesTableFilters>({
    search: '',
    subject: 'all',
    seatStatus: 'all',
    instructor: 'all',
    watcherCount: 'all',
  });

  const { sortField, sortDirection, toggleSort, renderSortIcon } = useTableSorting<SortField>();

  const filteredAndSortedClasses = useMemo(() => {
    let result = [...classes];

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter((classItem) => {
        const matchesClassNbr = classItem.class_nbr.includes(searchLower);
        const matchesTitle = classItem.title?.toLowerCase().includes(searchLower);
        return matchesClassNbr || matchesTitle;
      });
    }

    if (filters.subject !== 'all') {
      result = result.filter((classItem) => classItem.subject === filters.subject);
    }

    if (filters.seatStatus !== 'all') {
      result = result.filter((classItem) => {
        const { seats_available, seats_capacity } = classItem;
        const percentAvailable = seats_available / seats_capacity;

        if (filters.seatStatus === 'full') return seats_available === 0;
        if (filters.seatStatus === 'limited') return seats_available > 0 && percentAvailable < 0.2;
        if (filters.seatStatus === 'available') return percentAvailable >= 0.2;
        return true;
      });
    }

    if (filters.instructor !== 'all') {
      result = result.filter((classItem) => {
        const isStaff = !classItem.instructor_name || classItem.instructor_name === 'Staff';
        if (filters.instructor === 'staff') return isStaff;
        if (filters.instructor === 'named') return !isStaff;
        return true;
      });
    }

    if (filters.watcherCount !== 'all') {
      result = result.filter((classItem) => {
        const count = classItem.watcher_count;
        if (filters.watcherCount === 'none') return count === 0;
        if (filters.watcherCount === '1-5') return count >= 1 && count <= 5;
        if (filters.watcherCount === '6-10') return count >= 6 && count <= 10;
        if (filters.watcherCount === '10+') return count > 10;
        return true;
      });
    }

    if (sortField && sortDirection) {
      result.sort((a, b) => {
        let aVal: string | number;
        let bVal: string | number;

        if (sortField === 'class_nbr') {
          // Sort numerically for class numbers
          aVal = parseInt(a.class_nbr, 10);
          bVal = parseInt(b.class_nbr, 10);
        } else if (sortField === 'subject') {
          aVal = a.subject;
          bVal = b.subject;
        } else if (sortField === 'seats_available') {
          aVal = a.seats_available;
          bVal = b.seats_available;
        } else if (sortField === 'watcher_count') {
          aVal = a.watcher_count;
          bVal = b.watcher_count;
        } else if (sortField === 'seat_emails') {
          aVal = a.seat_emails;
          bVal = b.seat_emails;
        } else if (sortField === 'instructor_emails') {
          aVal = a.instructor_emails;
          bVal = b.instructor_emails;
        } else if (sortField === 'last_checked_at') {
          aVal = a.last_checked_at;
          bVal = b.last_checked_at;
        } else {
          return 0;
        }

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
  }, [classes, filters, sortField, sortDirection]);

  if (classes.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium mb-2">No classes found</p>
        <p className="text-sm">No classes are currently being watched by users</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <ClassesTableFiltersComponent
        subjects={uniqueSubjects}
        filters={filters}
        onFiltersChange={setFilters}
      />

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="w-[100px] cursor-pointer select-none hover:bg-muted/50"
                onClick={() => toggleSort('class_nbr')}
              >
                <div className="flex items-center">Class #{renderSortIcon('class_nbr')}</div>
              </TableHead>
              <TableHead
                className="w-[120px] cursor-pointer select-none hover:bg-muted/50"
                onClick={() => toggleSort('subject')}
              >
                <div className="flex items-center">
                  Subject
                  {renderSortIcon('subject')}
                </div>
              </TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Instructor</TableHead>
              <TableHead
                className="text-center w-[120px] cursor-pointer select-none hover:bg-muted/50"
                onClick={() => toggleSort('seats_available')}
              >
                <div className="flex items-center justify-center">
                  Seats
                  {renderSortIcon('seats_available')}
                </div>
              </TableHead>
              <TableHead
                className="text-center w-[100px] cursor-pointer select-none hover:bg-muted/50"
                onClick={() => toggleSort('watcher_count')}
              >
                <div className="flex items-center justify-center gap-1">
                  <Users className="size-4" />
                  <span>Watchers</span>
                  {renderSortIcon('watcher_count')}
                </div>
              </TableHead>
              <TableHead
                className="text-center w-[100px] cursor-pointer select-none hover:bg-muted/50"
                onClick={() => toggleSort('seat_emails')}
              >
                <div className="flex items-center justify-center gap-1">
                  <Mail className="size-4" />
                  <span>Seat Emails</span>
                  {renderSortIcon('seat_emails')}
                </div>
              </TableHead>
              <TableHead
                className="text-center w-[100px] cursor-pointer select-none hover:bg-muted/50"
                onClick={() => toggleSort('instructor_emails')}
              >
                <div className="flex items-center justify-center gap-1">
                  <Users className="size-4" />
                  <span>Instructor Emails</span>
                  {renderSortIcon('instructor_emails')}
                </div>
              </TableHead>
              <TableHead
                className="text-right w-[120px] cursor-pointer select-none hover:bg-muted/50"
                onClick={() => toggleSort('last_checked_at')}
              >
                <div className="flex items-center justify-end gap-1">
                  <Clock className="size-4" />
                  <span>Last Check</span>
                  {renderSortIcon('last_checked_at')}
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSortedClasses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No classes match the selected filters
                </TableCell>
              </TableRow>
            ) : (
              filteredAndSortedClasses.map((classItem) => (
                <TableRow
                  key={classItem.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => {
                    router.push(`/admin/classes/${classItem.class_nbr}`);
                  }}
                >
                  <TableCell className="font-mono font-semibold">
                    <Link
                      href={`/admin/classes/${classItem.class_nbr}`}
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

      {/* Results count */}
      {filteredAndSortedClasses.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Showing {filteredAndSortedClasses.length} of {classes.length} classes
        </p>
      )}
    </div>
  );
}
