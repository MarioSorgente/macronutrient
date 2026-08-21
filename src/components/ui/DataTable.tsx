"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/components/ui/cn";

export type Column<T> = {
  key: string;
  header: string;
  /** What to render in the cell. */
  cell: (row: T) => ReactNode;
  /** Return a comparable value to make the column sortable. Omit to disable. */
  sortBy?: (row: T) => string | number;
  align?: "left" | "right";
  className?: string;
};

/**
 * Sortable table. Wide content scrolls inside its own container rather than
 * pushing the page sideways, matching how the week grid handles overflow.
 */
export default function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  initialSort,
  empty,
  className,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  initialSort?: { key: string; dir: "asc" | "desc" };
  empty?: ReactNode;
  className?: string;
}) {
  const [sort, setSort] = useState(initialSort);

  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sort?.key);
    if (!column?.sortBy) return rows;
    const direction = sort?.dir === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const left = column.sortBy!(a);
      const right = column.sortBy!(b);
      if (typeof left === "number" && typeof right === "number") {
        return (left - right) * direction;
      }
      return String(left).localeCompare(String(right)) * direction;
    });
  }, [rows, columns, sort]);

  function toggle(key: string) {
    setSort((current) =>
      current?.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  }

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className={cn("scroll-slim overflow-x-auto", className)}>
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-cream-deep text-left text-[11px] uppercase tracking-wide text-charcoal-soft">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  sort?.key === column.key
                    ? sort.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
                className={cn("px-3 py-2 font-600", column.align === "right" && "text-right")}
              >
                {column.sortBy ? (
                  <button
                    type="button"
                    onClick={() => toggle(column.key)}
                    className={cn(
                      "inline-flex items-center gap-1 hover:text-charcoal",
                      column.align === "right" && "flex-row-reverse"
                    )}
                  >
                    {column.header}
                    {sort?.key === column.key &&
                      (sort.dir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "border-b border-cream-deep/60 last:border-0",
                onRowClick && "cursor-pointer hover:bg-cream-deep/40"
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-3 py-2 text-charcoal",
                    column.align === "right" && "text-right tabular-nums",
                    column.className
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
