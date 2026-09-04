'use client';

import { Search, X } from 'lucide-react';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDebouncedSearchParam } from '@/lib/hooks/useDebouncedSearchParam';

interface ClassesTableFiltersProps {
  subjects: string[];
  search: string;
  subject: string;
  seatStatus: 'all' | 'full' | 'limited' | 'available';
  instructor: 'all' | 'staff' | 'named';
  watcherCount: 'all' | 'none' | '1-5' | '6-10' | '10+';
  onNavigate: (updates: Record<string, string>) => void;
}
export function ClassesTableFiltersComponent({
  subjects,
  search,
  subject,
  seatStatus,
  instructor,
  watcherCount,
  onNavigate,
}: ClassesTableFiltersProps) {
  const onSearchChange = useCallback((v: string) => onNavigate({ search: v }), [onNavigate]);
  const [localSearch, handleSearchChange] = useDebouncedSearchParam(search, onSearchChange, 350);

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
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by class # or title..."
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

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
