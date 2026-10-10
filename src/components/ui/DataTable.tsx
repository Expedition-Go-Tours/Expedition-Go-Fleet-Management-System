"use client";

import { Children, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { cn } from "@/lib/cn";

/*
 * Semantic data table with a consistent header, density and empty state.
 * Column headers can be made sortable by supplying `onSort`; the page owns
 * the sort state and re-derives rows (server-side re-fetch or client sort).
 */

export interface DataTableColumn {
  key: string;
  header: ReactNode;
  className?: string;
  /** Rendered name of the column when sorting (e.g. "createdAt"). */
  sortKey?: string;
  onSort?: (key: string) => void;
  sortDir?: "asc" | "desc" | null;
}

export function DataTable({
  columns,
  children,
  className,
  empty,
  footer,
  caption,
}: {
  columns: DataTableColumn[];
  /** The <tbody> content. */
  children: ReactNode;
  className?: string;
  /** Shown in place of the table body when there are no rows. */
  empty?: ReactNode;
  footer?: ReactNode;
  caption?: string;
}) {
  // `empty` is a JSX element, so it is always truthy — we must decide from the
  // actual row count whether to render the body or the empty state. Relying on
  // `!empty` previously hid every row on pages that always pass an `empty` node.
  const hasRows = Children.count(children) > 0;
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-hairline border-b">
            {columns.map((column) => {
              const sortable = Boolean(column.onSort && column.sortKey);
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "font-ui bg-subtle text-muted px-4 py-2.5 text-[length:var(--fs-data-xs)] font-semibold tracking-[var(--tracking-ui)] whitespace-nowrap uppercase",
                    column.className,
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => column.onSort?.(column.sortKey!)}
                      className="hover:text-ink inline-flex items-center gap-1 uppercase transition-colors"
                    >
                      {column.header}
                      {column.sortDir === "asc" ? (
                        <ArrowUp aria-hidden="true" className="h-3 w-3" />
                      ) : column.sortDir === "desc" ? (
                        <ArrowDown aria-hidden="true" className="h-3 w-3" />
                      ) : (
                        <ArrowUpDown aria-hidden="true" className="text-faint h-3 w-3" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        {hasRows && <tbody className="divide-hairline divide-y">{children}</tbody>}
      </table>
      {!hasRows && empty && <div className="border-t-0">{empty}</div>}
      {footer && <div className="border-hairline bg-subtle border-t px-4 py-2.5">{footer}</div>}
    </div>
  );
}

/** Standard body cell. */
export function Td({
  children,
  className,
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={cn("px-4 py-3 align-middle", className)}>
      {children}
    </td>
  );
}

/** Primary cell content: truncates long titles with a tooltip. */
export function CellPrimary({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div className={cn("flex max-w-[16rem] min-w-0 items-center gap-2", className)} title={title}>
      <span className="text-data text-ink truncate font-medium">{children}</span>
    </div>
  );
}

/** Secondary/meta cell content (muted text). */
export function CellMeta({ children, className }: { children?: ReactNode; className?: string }) {
  return <span className={cn("text-data-xs text-muted", className)}>{children}</span>;
}
