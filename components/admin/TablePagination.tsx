import { Button } from '@/components/ui/button';

interface TablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  emptyMessage: string;
  itemNoun: string;
  onNavigate: (updates: Record<string, string>) => void;
}

export function TablePagination({
  page,
  pageSize,
  total,
  totalPages,
  emptyMessage,
  itemNoun,
  onNavigate,
}: TablePaginationProps) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        {total === 0 ? (
          emptyMessage
        ) : (
          <>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}{' '}
            {itemNoun}
          </>
        )}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onNavigate({ page: String(page - 1) })}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onNavigate({ page: String(page + 1) })}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
