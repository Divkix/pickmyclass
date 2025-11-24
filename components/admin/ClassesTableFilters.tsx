'use client';

import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface ClassesTableFilters {
  search: string;
  subject: string;
  seatStatus: 'all' | 'full' | 'limited' | 'available';
  instructor: 'all' | 'staff' | 'named';
  watcherCount: 'all' | 'none' | '1-5' | '6-10' | '10+';
}

interface ClassesTableFiltersProps {
  subjects: string[];
  filters: ClassesTableFilters;
  onFiltersChange: (filters: ClassesTableFilters) => void;
}

/**
 * Classes Table Filters Component
 *
 * Provides filtering controls for the classes table:
 * - Search by class number or title
 * - Filter by subject
 * - Filter by seat availability status
 * - Filter by instructor type (staff vs named)
 * - Filter by watcher count ranges
 */
export function ClassesTableFiltersComponent({
  subjects,
  filters,
  onFiltersChange,
}: ClassesTableFiltersProps) {
  // Update a single filter field
  const updateFilter = <K extends keyof ClassesTableFilters>(
    key: K,
    value: ClassesTableFilters[K]
  ) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  // Reset all filters to defaults
  const clearFilters = () => {
    onFiltersChange({
      search: '',
      subject: 'all',
      seatStatus: 'all',
      instructor: 'all',
      watcherCount: 'all',
    });
  };

  // Check if any filters are active
  const hasActiveFilters =
    filters.search !== '' ||
    filters.subject !== 'all' ||
    filters.seatStatus !== 'all' ||
    filters.instructor !== 'all' ||
    filters.watcherCount !== 'all';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by class # or title..."
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Subject Filter */}
        <Select value={filters.subject} onValueChange={(value) => updateFilter('subject', value)}>
          <SelectTrigger>
            <SelectValue placeholder="All Subjects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Subjects</SelectItem>
            {subjects.map((subject) => (
              <SelectItem key={subject} value={subject}>
                {subject}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Seat Status Filter */}
        <Select
          value={filters.seatStatus}
          onValueChange={(value) =>
            updateFilter('seatStatus', value as ClassesTableFilters['seatStatus'])
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Seat Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="full">Full (0 seats)</SelectItem>
            <SelectItem value="limited">Limited (&lt;20%)</SelectItem>
            <SelectItem value="available">Available (≥20%)</SelectItem>
          </SelectContent>
        </Select>

        {/* Instructor Filter */}
        <Select
          value={filters.instructor}
          onValueChange={(value) =>
            updateFilter('instructor', value as ClassesTableFilters['instructor'])
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Instructor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Instructors</SelectItem>
            <SelectItem value="staff">Staff</SelectItem>
            <SelectItem value="named">Named</SelectItem>
          </SelectContent>
        </Select>

        {/* Watcher Count Filter */}
        <Select
          value={filters.watcherCount}
          onValueChange={(value) =>
            updateFilter('watcherCount', value as ClassesTableFilters['watcherCount'])
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Watchers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Watchers</SelectItem>
            <SelectItem value="none">No Watchers</SelectItem>
            <SelectItem value="1-5">1-5 Watchers</SelectItem>
            <SelectItem value="6-10">6-10 Watchers</SelectItem>
            <SelectItem value="10+">10+ Watchers</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Clear Filters Button */}
      {hasActiveFilters && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Filters active</p>
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 gap-1.5">
            <X className="size-4" />
            Clear Filters
          </Button>
        </div>
      )}
    </div>
  );
}
