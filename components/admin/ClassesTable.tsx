'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Users, Clock, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { ClassesTableFiltersComponent, type ClassesTableFilters } from './ClassesTableFilters';
import type { ClassWithWatchers } from '@/lib/db/admin-queries';

interface ClassesTableProps {
  classes: ClassWithWatchers[];
}

type SortField = 'class_nbr' | 'subject' | 'seats_available' | 'watcher_count' | 'last_checked_at';
type SortDirection = 'asc' | 'desc' | null;

/**
 * Format timestamp to relative time string
 */
function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

/**
 * Get seat status badge variant based on availability
 */
function getSeatBadgeVariant(
  available: number,
  capacity: number
): 'success' | 'destructive' | 'warning' {
  if (available === 0) return 'destructive';
  if (available / capacity < 0.2) return 'warning';
  return 'success';
}

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

  // Extract unique subjects for filter dropdown (memoized)
  const uniqueSubjects = useMemo(() => {
    const subjects = new Set(classes.map((c) => c.subject));
    return Array.from(subjects).sort();
  }, [classes]);

  // Filter state
  const [filters, setFilters] = useState<ClassesTableFilters>({
    search: '',
    subject: 'all',
    seatStatus: 'all',
    instructor: 'all',
    watcherCount: 'all',
  });

  // Sort state
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Toggle sort for a column
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      // Cycle through: asc -> desc -> null
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortField(null);
        setSortDirection(null);
      }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Render sort icon for column header
  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ChevronsUpDown className="size-4 ml-1 text-muted-foreground" />;
    }
    if (sortDirection === 'asc') {
      return <ChevronUp className="size-4 ml-1" />;
    }
    return <ChevronDown className="size-4 ml-1" />;
  };

  // Filtered and sorted classes (memoized for performance)
  const filteredAndSortedClasses = useMemo(() => {
    let result = [...classes];

    // Apply filters
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

    // Apply sorting
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
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
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
