import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { SortDirection } from './table-types';

export function useTableSorting<T extends string>() {
  const [sortField, setSortField] = useState<T | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  const toggleSort = (field: T) => {
    if (sortField === field) {
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

  const renderSortIcon = (field: T) => {
    if (sortField !== field) {
      return <ChevronsUpDown className="size-4 ml-1 text-muted-foreground" />;
    }
    if (sortDirection === 'asc') {
      return <ChevronUp className="size-4 ml-1" />;
    }
    return <ChevronDown className="size-4 ml-1" />;
  };

  return { sortField, sortDirection, toggleSort, renderSortIcon };
}
