import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ComparisonColumn {
  key: string;
  label: string;
}

type ComparisonRow = Record<string, string>;

interface ComparisonTableProps {
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
  caption?: string;
  highlightedRow?: string;
}

export function ComparisonTable({ columns, rows, caption, highlightedRow }: ComparisonTableProps) {
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
          {rows.map((row) => {
            const labelKey = columns[0].key;
            const label = row[labelKey];
            const highlighted = label === highlightedRow;

            return (
              <TableRow
                key={label}
                className={highlighted ? "bg-primary/5 border-l-2 border-l-primary" : ""}
              >
                {columns.map((col) => (
                  <TableCell
                    key={col.key}
                    className={
                      highlighted && col.key === labelKey ? "font-medium text-foreground" : ""
                    }
                  >
                    {row[col.key]}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
