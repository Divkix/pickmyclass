'use client';

import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Keep the legacy interface for backwards compatibility with any existing imports.
interface ClassesTableFiltersProps {
  subjects: string[];
  /** Current filter values (from URL searchParams via parent) */
  search: string;
  subject: string;
  seatStatus: 'all' | 'full' | 'limited' | 'available';
  instructor: 'all' | 'staff' | 'named';
  watcherCount: 'all' | 'none' | '1-5' | '6-10' | '10+';
  /**
   * Called with a flat map of searchParam updates when any filter changes.
   * The parent component (ClassesTable) merges these into the URL.
   */
  onNavigate: (updates: Record<string, string>) => void;
}

const SEARCH_DEBOUNCE_MS = 350;

/**
 * Classes Table Filters Component
 *
 * URL-driven: filter changes update URL searchParams so the server re-queries.
 * Search is debounced to avoid a request on every keystroke.
 */
export function ClassesTableFiltersComponent({
  subjects,
  search,
  subject,
  seatStatus,
  instructor,
  watcherCount,
  onNavigate,
}: ClassesTableFiltersProps) {
  // Local state for search input so it feels responsive while debouncing
  const [localSearch, setLocalSearch] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when the URL-driven value changes (e.g. clear button)
  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setLocalSearch(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onNavigate({ search: value });
      }, SEARCH_DEBOUNCE_MS);
    },
    [onNavigate]
  );

  const clearFilters = () => {
    onNavigate({
      search: '',
      subject: 'all',
      seatStatus: 'all',
      instructor: 'all',
      watcherCount: 'all',
    });
  };

  const hasActiveFilters =
    search !== '' ||
    subject !== 'all' ||
    seatStatus !== 'all' ||
    instructor !== 'all' ||
    watcherCount !== 'all';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Search Input (debounced) */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by class # or title..."
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Subject Filter */}
        <Select value={subject} onValueChange={(value) => onNavigate({ subject: value })}>
          <SelectTrigger>
            <SelectValue placeholder="All Subjects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Subjects</SelectItem>
            {subjects.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Seat Status Filter */}
        <Select value={seatStatus} onValueChange={(value) => onNavigate({ seatStatus: value })}>
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
        <Select value={instructor} onValueChange={(value) => onNavigate({ instructor: value })}>
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
        <Select value={watcherCount} onValueChange={(value) => onNavigate({ watcherCount: value })}>
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
