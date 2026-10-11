"use client";

import { useCallback, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/*
 * Accessible tab list (WAI-ARIA tabs pattern). `tabs` is rendered as buttons
 * with proper roles; panels are labelled by the active tab.
 *
 * Supports keyboard navigation: Left/Right arrows move between tabs (wrapping
 * around), Home/End jump to the first/last tab.
 */

export function Tabs({
  tabs,
  initial,
  onTabChange,
}: {
  tabs: { id: string; label: string; badge?: ReactNode; panel: ReactNode }[];
  initial?: string;
  onTabChange?: (id: string) => void;
}) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id ?? "");
  const baseId = useId();
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  function select(id: string) {
    setActive(id);
    onTabChange?.(id);
  }

  const setTabRef = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) {
      tabRefs.current.set(id, el);
    } else {
      tabRefs.current.delete(id);
    }
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    const ids = tabs.map((t) => t.id);
    const currentIndex = ids.indexOf(active);
    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        nextIndex = (currentIndex + 1) % ids.length;
        break;
      case "ArrowLeft":
        event.preventDefault();
        nextIndex = (currentIndex - 1 + ids.length) % ids.length;
        break;
      case "Home":
        event.preventDefault();
        nextIndex = 0;
        break;
      case "End":
        event.preventDefault();
        nextIndex = ids.length - 1;
        break;
      default:
        return;
    }

    if (nextIndex !== null) {
      const nextId = ids[nextIndex]!;
      select(nextId);
      tabRefs.current.get(nextId)?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Record sections"
        className="border-hairline border-b"
        onKeyDown={onKeyDown}
      >
        <div data-lenis-prevent className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const selected = tab.id === active;
            return (
              <button
                key={tab.id}
                ref={(el) => setTabRef(tab.id, el)}
                role="tab"
                id={`${baseId}-${tab.id}-tab`}
                aria-selected={selected}
                aria-controls={`${baseId}-${tab.id}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(tab.id)}
                className={cn(
                  "text-body-sm inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 whitespace-nowrap transition-colors",
                  selected
                    ? "border-accent text-ink font-semibold"
                    : "hover:text-ink text-muted border-transparent",
                )}
              >
                {tab.label}
                {tab.badge !== undefined && tab.badge}
              </button>
            );
          })}
        </div>
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-${active}-panel`}
        aria-labelledby={`${baseId}-${active}-tab`}
      >
        {tabs.find((t) => t.id === active)?.panel}
      </div>
    </div>
  );
}
