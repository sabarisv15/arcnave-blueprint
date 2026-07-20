import { useState } from 'react';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { inferEntityFromRecord, resolveEntityRoute } from '@/features/ai/lib/entityRoutes';

const PAGE_SIZE = 100;

const STATUS_VARIANTS = [
  { pattern: /approv|paid|success|active|present|completed/i, variant: 'success' },
  { pattern: /pending|awaiting|draft/i, variant: 'warning' },
  { pattern: /reject|overdue|fail|absent|cancel/i, variant: 'destructive' },
];

function statusVariant(value) {
  const match = STATUS_VARIANTS.find((v) => v.pattern.test(String(value)));
  return match ? match.variant : 'secondary';
}

// Pure presentation: `columns`/`rows` come pre-formatted from the
// backend AI Experience Layer's sectionBuilder.js (details.type ===
// 'table'); `rawRecords`, when present, is the underlying tool data
// array (same length/order as `rows`) used only to resolve entity
// links — no data is derived or fetched here.
export function DataTable({
  columns, rows, rawRecords, toolUsed,
}) {
  const [page, setPage] = useState(0);
  if (!columns || !rows || rows.length === 0) return null;

  const statusColIndex = columns.findIndex((c) => /status|state/i.test(c));
  const nameColIndex = columns.findIndex((c) => /name/i.test(c));

  const pageCount = Math.ceil(rows.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  return (
    <div className="space-y-2">
      <div className="max-h-[420px] overflow-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col} scope="col">{col}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row, rowIdx) => {
              const absoluteIdx = start + rowIdx;
              const rawRecord = rawRecords && rawRecords[absoluteIdx];
              const entity = rawRecord ? inferEntityFromRecord(rawRecord, toolUsed) : null;
              const href = entity ? resolveEntityRoute(entity.entityType, entity.id) : null;

              return (
                // eslint-disable-next-line react/no-array-index-key
                <TableRow key={absoluteIdx}>
                  {row.map((cell, colIdx) => {
                    if (colIdx === statusColIndex) {
                      return (
                        <TableCell key={columns[colIdx]}>
                          <Badge variant={statusVariant(cell)}>{cell}</Badge>
                        </TableCell>
                      );
                    }
                    if (colIdx === nameColIndex && href) {
                      return (
                        <TableCell key={columns[colIdx]}>
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline underline-offset-2 hover:no-underline"
                          >
                            {cell}
                          </a>
                        </TableCell>
                      );
                    }
                    return <TableCell key={columns[colIdx]}>{cell}</TableCell>;
                  })}
                </TableRow>
              );
            })}
          </TableBody>
          {rows.length > PAGE_SIZE && (
            <TableCaption className="pb-2">
              Showing {start + 1}-{Math.min(start + PAGE_SIZE, rows.length)} of {rows.length} rows
            </TableCaption>
          )}
        </Table>
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {page + 1} of {pageCount}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
