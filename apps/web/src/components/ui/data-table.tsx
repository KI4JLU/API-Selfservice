import * as React from 'react';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type Row } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { Skeleton } from './skeleton';
import { Button } from './button';
import { cn } from '@/lib/utils';

export interface DataTableProps<T> {
  columns: ColumnDef<T, any>[];
  data: T[];
  isLoading?: boolean;
  testId?: string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  emptyText?: React.ReactNode;
  getRowId?: (row: T, index: number) => string;
  renderExpanded?: (row: Row<T>) => React.ReactNode;
  expandedId?: string | null;
}

export function DataTable<T>({ columns, data, isLoading, testId, onRowClick, rowClassName, emptyText, getRowId, renderExpanded, expandedId }: DataTableProps<T>) {
  const { t } = useTranslation();
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel(), getRowId });
  const colCount = columns.length;
  return (
    <div className="rounded-md border" data-testid={testId}>
      <Table>
      <TableHeader className="bg-muted/50">
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id} className="hover:bg-transparent">
            {hg.headers.map((h) => (
              <TableHead key={h.id} style={{ width: h.getSize() !== 150 ? h.getSize() : undefined }} className={(h.column.columnDef.meta as { className?: string } | undefined)?.className}>
                {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {isLoading && data.length === 0 ? (
          Array.from({ length: 4 }).map((_, i) => (
            <TableRow key={`s${i}`}>
              {Array.from({ length: colCount }).map((__, j) => (
                <TableCell key={j}>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : data.length === 0 ? (
          <TableRow>
            <TableCell colSpan={colCount} className="h-24 text-center">
              {emptyText ?? t('common.empty')}
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <React.Fragment key={row.id}>
              <TableRow
                data-testid="table-row"
                data-row-id={row.id}
                className={cn(onRowClick && 'cursor-pointer', rowClassName?.(row.original))}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={(cell.column.columnDef.meta as { className?: string } | undefined)?.className}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
              {renderExpanded && expandedId === row.id ? (
                <TableRow className="hover:bg-transparent bg-muted/30">
                  <TableCell colSpan={colCount} className="p-4">
                    {renderExpanded(row)}
                  </TableCell>
                </TableRow>
              ) : null}
            </React.Fragment>
          ))
        )}
      </TableBody>
      </Table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange: (p: number) => void }) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize && page === 1) return null;
  return (
    <div className="text-muted-foreground flex items-center justify-between gap-2 text-sm">
      <span>
        {t('common.page')} {page} {t('common.of')} {pages} · {total}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          {t('common.previous')}
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          {t('common.next')}
        </Button>
      </div>
    </div>
  );
}
