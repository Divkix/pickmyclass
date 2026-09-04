import type { ReactNode } from 'react';
import { TableHead } from '@/components/ui/table';

type Align = 'left' | 'center' | 'right';

interface SortableHeaderProps<F extends string> {
  field: F;
  label: string;
  toggleSort: (field: F) => void;
  renderSortIcon: (field: F) => ReactNode;
  align?: Align;
  className?: string;
  children?: ReactNode;
}

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

  return (
    <TableHead className={`select-none${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className={`flex items-center gap-1 cursor-pointer hover:text-foreground w-full${justifyClass ? ` ${justifyClass}` : ''}${textAlignClass ? ` ${textAlignClass}` : ''}`}
        onClick={() => toggleSort(field)}
      >
        {children}
        <span>{label}</span>
        {renderSortIcon(field)}
      </button>
    </TableHead>
  );
}
