import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';
import type { SortDirection } from './table-types';

interface SortIconProps {
  field: string;
  sortField: string | null;
  sortDirection: SortDirection;
}

export function SortIcon({ field, sortField, sortDirection }: SortIconProps) {
  if (sortField !== field) {
    return <ChevronsUpDown className="size-4 ml-1 text-muted-foreground" />;
  }
  if (sortDirection === 'asc') {
    return <ChevronUp className="size-4 ml-1" />;
  }
  return <ChevronDown className="size-4 ml-1" />;
}
