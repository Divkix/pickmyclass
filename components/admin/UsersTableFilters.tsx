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

interface UsersTableFiltersProps {
  search: string;
  role: 'all' | 'admin' | 'user';
  verified: 'all' | 'verified' | 'unverified';
  watchCount: 'all' | 'none' | '1-5' | '6-10' | '10+';
  onNavigate: (updates: Record<string, string>) => void;
}

export function UsersTableFiltersComponent({
  search,
  role,
  verified,
  watchCount,
  onNavigate,
}: UsersTableFiltersProps) {
  const onSearchChange = useCallback((v: string) => onNavigate({ search: v }), [onNavigate]);
  const [localSearch, handleSearchChange] = useDebouncedSearchParam(search, onSearchChange, 350);

  const clearFilters = () => {
    onNavigate({ search: '', role: 'all', verified: 'all', watchCount: 'all' });
  };

  const hasActiveFilters =
    search !== '' || role !== 'all' || verified !== 'all' || watchCount !== 'all';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by email..."
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={role} onValueChange={(value) => onNavigate({ role: value })}>
          <SelectTrigger>
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="user">User</SelectItem>
          </SelectContent>
        </Select>

        <Select value={verified} onValueChange={(value) => onNavigate({ verified: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Email Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Emails</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="unverified">Unverified</SelectItem>
          </SelectContent>
        </Select>

        <Select value={watchCount} onValueChange={(value) => onNavigate({ watchCount: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Watch Count" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Watch Counts</SelectItem>
            <SelectItem value="none">No Watches</SelectItem>
            <SelectItem value="1-5">1-5 Watches</SelectItem>
            <SelectItem value="6-10">6-10 Watches</SelectItem>
            <SelectItem value="10+">10+ Watches</SelectItem>
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
