"use client";

import { useEffect, useRef } from "react";
import { CircleHelp, Play, RotateCcw } from "lucide-react";

import { useOnboarding } from "@/components/onboarding/context";

/**
 * Persistent entry point for guided tours. Lives in the header next to the
 * notification bell, so a tour is always reachable after the welcome modal was
 * postponed — and every tour is replayable from here.
 */
export function HelpMenu() {
  const { helpOpen, setHelpOpen, tours, startTour, statusFor, activeTour } = useOnboarding();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!helpOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setHelpOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setHelpOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [helpOpen, setHelpOpen]);

  if (tours.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-tour="header-help"
        onClick={() => setHelpOpen(!helpOpen)}
        aria-label="Help and guided tours"
        aria-expanded={helpOpen}
        aria-haspopup="menu"
        className="hover:bg-subtle text-ink flex h-9 w-9 items-center justify-center rounded-md transition-colors"
      >
        <CircleHelp aria-hidden="true" className="h-[18px] w-[18px]" />
      </button>

      {helpOpen && (
        <div
          role="menu"
          aria-label="Help and guided tours"
          className="border-hairline bg-surface absolute top-11 right-0 z-40 w-[19rem] overflow-hidden rounded-lg border shadow-[var(--shadow-lg)]"
        >
          <div className="border-hairline bg-subtle border-b px-4 py-3">
            <p className="font-heading text-card-title text-ink font-semibold">Guided tours</p>
            <p className="text-body-xs text-muted mt-0.5">
              Short walkthroughs of the controls your role can use. Nothing is submitted while a
              tour runs.
            </p>
          </div>

          <ul data-lenis-prevent className="max-h-[22rem] overflow-y-auto py-1">
            {tours.map((tour) => {
              const status = statusFor(tour);
              const isCompleted = status === "Completed";
              const isRunning = activeTour?.id === tour.id;
              return (
                <li key={tour.id}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={isRunning}
                    onClick={() => startTour(tour.id)}
                    className="hover:bg-subtle flex w-full items-start gap-3 px-4 py-3 text-left disabled:opacity-60"
                  >
                    <span className="bg-accent/10 text-accent mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md">
                      {isCompleted ? (
                        <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                      ) : (
                        <Play aria-hidden="true" className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-data text-ink block font-semibold">
                        {tour.title}
                        {isRunning && " · running"}
                      </span>
                      <span className="text-body-xs text-muted mt-0.5 block">{tour.summary}</span>
                      <span className="font-ui text-faint mt-1 block text-[10px] tracking-[var(--tracking-ui)] uppercase">
                        {status} · {tour.steps.length} steps
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
