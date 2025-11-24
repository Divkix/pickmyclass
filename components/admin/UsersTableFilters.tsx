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

export interface UsersTableFilters {
  search: string;
  role: 'all' | 'admin' | 'user';
  verified: 'all' | 'verified' | 'unverified';
  watchCount: 'all' | 'none' | '1-5' | '6-10' | '10+';
}

interface UsersTableFiltersProps {
  filters: UsersTableFilters;
  onFiltersChange: (filters: UsersTableFilters) => void;
}

/**
 * Users Table Filters Component
 *
 * Provides filtering controls for the users table:
 * - Search by email
 * - Filter by role (admin/user)
 * - Filter by email verification status
 * - Filter by watch count ranges
 */
export function UsersTableFiltersComponent({ filters, onFiltersChange }: UsersTableFiltersProps) {
  // Update a single filter field
  const updateFilter = <K extends keyof UsersTableFilters>(key: K, value: UsersTableFilters[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  // Reset all filters to defaults
  const clearFilters = () => {
    onFiltersChange({
      search: '',
      role: 'all',
      verified: 'all',
      watchCount: 'all',
    });
  };

  // Check if any filters are active
  const hasActiveFilters =
    filters.search !== '' ||
    filters.role !== 'all' ||
    filters.verified !== 'all' ||
    filters.watchCount !== 'all';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by email..."
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Role Filter */}
        <Select
          value={filters.role}
          onValueChange={(value) => updateFilter('role', value as UsersTableFilters['role'])}
        >
          <SelectTrigger>
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="user">User</SelectItem>
          </SelectContent>
        </Select>

        {/* Email Verified Filter */}
        <Select
          value={filters.verified}
          onValueChange={(value) =>
            updateFilter('verified', value as UsersTableFilters['verified'])
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Email Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Emails</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="unverified">Unverified</SelectItem>
          </SelectContent>
        </Select>

        {/* Watch Count Filter */}
        <Select
          value={filters.watchCount}
          onValueChange={(value) =>
            updateFilter('watchCount', value as UsersTableFilters['watchCount'])
          }
        >
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
