"use client";

import { CircleCheck, X } from "lucide-react";

import { Button } from "@/components/ui/Button";

/**
 * Completion confirmation for a finished tour. Rendered by the onboarding
 * provider so it can be cleared from an event handler (never from an effect)
 * and so a new tour started right away replaces it.
 */
export function CompletionToast({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-tour="tour-complete"
      className="bg-surface border-hairline fixed bottom-4 left-1/2 z-40 flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-3 rounded-lg border p-4 shadow-[var(--shadow-lg)]"
    >
      <span className="bg-success/10 text-success mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
        <CircleCheck aria-hidden="true" className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-data text-ink font-semibold">{title} complete</p>
        <p className="text-body-xs text-muted mt-0.5">
          You can replay it any time from the Help menu in the header.
        </p>
      </div>
      <Button variant="ghost" size="xs" aria-label="Dismiss" onClick={onClose}>
        <X aria-hidden="true" className="h-4 w-4" />
      </Button>
    </div>
  );
}
