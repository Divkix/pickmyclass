import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface ComparisonColumn {
  key: string;
  label: string;
}

type ComparisonRow = {
  [key: string]: string | boolean | undefined;
};

interface ComparisonTableProps {
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
  caption?: string;
}

export function ComparisonTable({ columns, rows, caption }: ComparisonTableProps) {
  return (
    <div className="not-prose my-6 overflow-x-auto rounded-lg border border-border">
      <Table>
        {caption && <caption className="text-sm text-muted-foreground mt-4">{caption}</caption>}
        <TableHeader>
          <TableRow className="bg-muted/50">
            {columns.map((col) => (
              <TableHead key={col.key} className="font-semibold text-foreground">
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={String(row[columns[0].key])}
              className={row.highlight ? 'bg-primary/5 border-l-2 border-l-primary' : ''}
            >
              {columns.map((col) => (
                <TableCell
                  key={col.key}
                  className={`${row.highlight && col.key === columns[0].key ? 'font-medium text-foreground' : ''}`}
                >
                  {row[col.key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
