"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";

/*
 * Accessible modal dialog (focus trap, ESC to close, labelled). Rendered with
 * `createPortal`-free markup inside the component tree; the overlay covers the
 * viewport. Used for forms and confirmations that must not lose context.
 */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab") {
        // Keep focus inside the panel.
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const sizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="presentation"
    >
      {/* Overlay */}
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/45 backdrop-blur-[1px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "bg-surface relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-xl shadow-[var(--shadow-lg)] outline-none sm:rounded-lg",
          sizes[size],
        )}
      >
        <header className="border-hairline flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="font-heading text-card-title text-ink font-semibold">
              {title}
            </h2>
            {description && <p className="text-body-xs text-muted">{description}</p>}
          </div>
          <Button variant="ghost" size="xs" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="bg-subtle border-hairline flex items-center justify-end gap-2 border-t px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
