"use client";

import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/*
 * Accessible tab list (WAI-ARIA tabs pattern). `tabs` is rendered as buttons
 * with proper roles; panels are labelled by the active tab.
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

  function select(id: string) {
    setActive(id);
    onTabChange?.(id);
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Record sections" className="border-b border-hairline">
        <div className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const selected = tab.id === active;
            return (
              <button
                key={tab.id}
                role="tab"
                id={`${baseId}-${tab.id}-tab`}
                aria-selected={selected}
                aria-controls={`${baseId}-${tab.id}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(tab.id)}
                className={cn(
                  "text-body-sm inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 transition-colors",
                  selected
                    ? "border-accent font-semibold text-ink"
                    : "hover:text-ink border-transparent text-muted",
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