"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

/**
 * Sortable table header. Renders a link that updates `sort`/`dir` in the URL
 * (preserving every other filter), so sorting stays server-rendered.
 */
export function TableSort({
  label,
  sortKey,
  basePath,
}: {
  label: string;
  sortKey: string;
  basePath: string;
}) {
  const searchParams = useSearchParams();
  const currentSort = searchParams.get("sort");
  const currentDir = searchParams.get("dir") === "asc" ? "asc" : "desc";

  const active = currentSort === sortKey;
  const dir = currentDir;

  function href(): string {
    const params = new URLSearchParams(searchParams.toString());
    if (active) {
      params.set("dir", dir === "asc" ? "desc" : "asc");
    } else {
      params.set("sort", sortKey);
      params.set("dir", "asc");
    }
    params.delete("page");
    return `${basePath}?${params.toString()}`;
  }

  return (
    <Link
      href={href()}
      aria-label={`Sort by ${label}`}
      className="hover:text-ink inline-flex items-center gap-1 uppercase transition-colors"
    >
      {label}
      {active && dir === "asc" ? (
        <ArrowUp aria-hidden="true" className="h-3 w-3" />
      ) : active && dir === "desc" ? (
        <ArrowDown aria-hidden="true" className="h-3 w-3" />
      ) : (
        <ArrowUpDown aria-hidden="true" className="h-3 w-3 text-faint" />
      )}
    </Link>
  );
}