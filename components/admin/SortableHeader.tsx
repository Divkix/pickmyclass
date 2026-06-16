import type { ReactNode } from 'react';
import { TableHead } from '@/components/ui/table';

type Align = 'left' | 'center' | 'right';

interface SortableHeaderProps<F extends string> {
  field: F;
  label: string;
  toggleSort: (field: F) => void;
  renderSortIcon: (field: F) => ReactNode;
  /** Alignment of the button content. Defaults to 'left'. */
  align?: Align;
  /** Extra className forwarded to the wrapping <TableHead>. */
  className?: string;
  /** Optional icon(s) to render before the label text. */
  children?: ReactNode;
}

/**
 * A reusable sortable column header for admin data tables.
 *
 * Wraps `<TableHead>` + an accessible `<button>` that calls `toggleSort` on
 * click and on Enter / Space keydown. Renders the sort indicator via the
 * `renderSortIcon` callback supplied by `useTableSorting`.
 */
export function SortableHeader<F extends string>({
  field,
  label,
  toggleSort,
  renderSortIcon,
  align = 'left',
  className,
  children,
}: SortableHeaderProps<F>) {
  const justifyClass =
    align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : '';
  const textAlignClass = align === 'left' ? 'text-left' : '';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleSort(field);
    }
  };

  return (
    <TableHead className={`select-none${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className={`flex items-center gap-1 cursor-pointer hover:text-foreground w-full${justifyClass ? ` ${justifyClass}` : ''}${textAlignClass ? ` ${textAlignClass}` : ''}`}
        onClick={() => toggleSort(field)}
        onKeyDown={handleKeyDown}
      >
        {children}
        <span>{label}</span>
        {renderSortIcon(field)}
      </button>
    </TableHead>
  );
}
