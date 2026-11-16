"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * Page-header export control: one trigger, a CSV and a PDF download inside.
 *
 * Both items are plain anchors carrying the page's active filters (the caller
 * builds the hrefs with `exportHref`), so a download needs no client fetch or
 * blob plumbing — the browser saves the attachment the route returns. The
 * menu shows what will be exported (the active date range, vehicle, …) so a
 * user never has to guess which filter the file respects.
 */
export function ExportMenu({
  csvHref,
  pdfHref,
  hint,
  dataTour,
}: {
  csvHref: string;
  pdfHref: string;
  /** Active filters, e.g. "01 Oct – 18 Oct 2026 · GT-1234-26". */
  hint?: string;
  /** Stable `data-tour` hook targeted by the guided tours. */
  dataTour?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const items = [
    {
      key: "csv",
      href: csvHref,
      icon: FileSpreadsheet,
      title: "Download CSV",
      description: "One row per record — opens in any spreadsheet",
    },
    {
      key: "pdf",
      href: pdfHref,
      icon: FileText,
      title: "Download PDF",
      description: "Formatted report with totals and page numbers",
    },
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-tour={dataTour}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="border-strong hover:border-ink rounded-pill font-ui inline-flex items-center gap-1.5 border px-4 py-2 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase transition-colors"
      >
        <Download aria-hidden="true" className="h-3.5 w-3.5" />
        Export
        <ChevronDown
          aria-hidden="true"
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Export records"
          className="border-hairline bg-surface absolute top-full right-auto left-0 z-40 mt-2 w-[17.5rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border shadow-[var(--shadow-lg)] sm:right-0 sm:left-auto"
        >
          <div className="border-hairline bg-subtle border-b px-4 py-3">
            <p className="font-heading text-card-title text-ink font-semibold">Export records</p>
            {hint && <p className="text-body-xs text-muted mt-0.5">{hint}</p>}
          </div>
          <ul className="py-1">
            {items.map((item) => (
              <li key={item.key}>
                <a
                  role="menuitem"
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="hover:bg-subtle flex w-full items-start gap-3 px-4 py-3 text-left"
                >
                  <span className="bg-accent/10 text-accent mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md">
                    <item.icon aria-hidden="true" className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-data text-ink block font-semibold">{item.title}</span>
                    <span className="text-body-xs text-muted mt-0.5 block">{item.description}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
