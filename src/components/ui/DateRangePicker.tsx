"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { DateRange } from "@daypicker/react";
import { CalendarDays, ChevronDown, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DateRangeCalendar } from "@/components/ui/DateRangeCalendar";
import { Modal } from "@/components/ui/Modal";
import {
  daysInRange,
  formatDateRangeLabel,
  parseDateKey,
  resolveDateRange,
  toDateKey,
  type DateRangeValue,
} from "@/lib/domain/date-range";
import { cn } from "@/lib/cn";

/*
 * Booking-style from/to picker. The applied range lives in the URL (`from` and
 * `to`, inclusive `YYYY-MM-DD` days) so every page keeps its server-rendered
 * filtering. A first click starts a new range, a second click closes it, and a
 * single day is a valid range.
 */

interface Preset {
  key: string;
  label: string;
  build: (now: Date) => DateRange;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

const PRESETS: Preset[] = [
  {
    key: "today",
    label: "Today",
    build: (now) => ({ from: now, to: now }),
  },
  {
    key: "last-7",
    label: "Last 7 days",
    build: (now) => ({ from: addDays(now, -6), to: now }),
  },
  {
    key: "last-30",
    label: "Last 30 days",
    build: (now) => ({ from: addDays(now, -29), to: now }),
  },
  {
    key: "this-month",
    label: "This month",
    build: (now) => ({ from: monthStart(now), to: monthEnd(now) }),
  },
  {
    key: "last-month",
    label: "Last month",
    build: (now) => {
      const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { from: monthStart(previous), to: monthEnd(previous) };
    },
  },
];

/** Desktop shows two months; the modal is a bottom sheet with one on phones. */
function useMinWidth(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function draftRangeOf(draft: DateRange | undefined): DateRangeValue | null {
  if (!draft?.from) return null;
  return resolveDateRange({
    from: toDateKey(draft.from),
    to: toDateKey(draft.to ?? draft.from),
  });
}

export function DateRangePicker({
  basePath,
  placeholder = "Any date",
  description = "Choose a start and end date, or a single day. Both dates are inclusive.",
}: {
  /** Page the filter belongs to, e.g. "/fuel". */
  basePath: string;
  /** Trigger copy when no date filter is active. */
  placeholder?: string;
  /** Shown inside the modal, so each page can say what the range affects. */
  description?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  // The first click of a new selection; the next click becomes the other end.
  const [anchor, setAnchor] = useState<Date | null>(null);
  const showTwoMonths = useMinWidth("(min-width: 768px)");

  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const appliedRange = resolveDateRange({ from: fromParam, to: toParam });

  function writeRange(range: DateRangeValue | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (range) {
      params.set("from", range.from);
      params.set("to", range.to);
    } else {
      params.delete("from");
      params.delete("to");
    }
    // A new period invalidates the old page offset.
    params.delete("page");
    const query = params.toString();
    startTransition(() => router.replace(query ? `${basePath}?${query}` : basePath));
  }

  function openPicker() {
    const current = resolveDateRange({ from: fromParam, to: toParam });
    const start = current ? parseDateKey(current.from) : null;
    const end = current ? parseDateKey(current.to) : null;
    setDraft(start && end ? { from: start, to: end } : undefined);
    setAnchor(null);
    setOpen(true);
  }

  function handleDaySelect(_range: DateRange | undefined, triggerDate: Date) {
    if (anchor) {
      const start = anchor.getTime() <= triggerDate.getTime() ? anchor : triggerDate;
      const end = anchor.getTime() <= triggerDate.getTime() ? triggerDate : anchor;
      setDraft({ from: start, to: end });
      setAnchor(null);
      return;
    }
    // Start a fresh range; clicking once is a valid single-day filter.
    setDraft({ from: triggerDate, to: triggerDate });
    setAnchor(triggerDate);
  }

  function handlePreset(preset: Preset) {
    setDraft(preset.build(new Date()));
    setAnchor(null);
  }

  function handleApply() {
    writeRange(draftRangeOf(draft));
    setOpen(false);
  }

  function handleClear() {
    setDraft(undefined);
    setAnchor(null);
    if (appliedRange) {
      writeRange(null);
      setOpen(false);
    }
  }

  const draftRange = draftRangeOf(draft);
  const draftLabel = draftRange ? formatDateRangeLabel(draftRange) : null;
  const activePreset = draftRange
    ? PRESETS.find((preset) => {
        const candidate = draftRangeOf(preset.build(new Date()));
        return candidate?.from === draftRange.from && candidate?.to === draftRange.to;
      })?.key
    : undefined;

  const dayCount = draftRange ? daysInRange(draftRange) : 0;
  const hint = anchor
    ? "Now choose an end date"
    : draftRange
      ? `${dayCount} day${dayCount === 1 ? "" : "s"}`
      : "Showing all dates";

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          appliedRange ? `Filter by date: ${formatDateRangeLabel(appliedRange)}` : "Filter by date"
        }
        className={cn(
          "field-control group flex items-center gap-2 text-left transition-opacity sm:w-auto sm:min-w-56",
          isPending && "opacity-60",
        )}
      >
        <CalendarDays aria-hidden="true" className="text-muted h-4 w-4 shrink-0" />
        <span className={cn("truncate", appliedRange ? "text-ink font-medium" : "text-muted")}>
          {appliedRange ? formatDateRangeLabel(appliedRange) : placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "text-faint ml-auto h-4 w-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Filter by date"
        description={description}
        size="lg"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto"
              onClick={handleClear}
              disabled={!appliedRange && !draftRange}
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
              Clear dates
            </Button>
            <Button variant="primary" size="sm" onClick={handleApply}>
              Apply
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => handlePreset(preset)}
                aria-pressed={activePreset === preset.key}
                className={cn(
                  "rounded-pill border-hairline text-body-xs border px-3 py-1 font-medium transition-colors",
                  activePreset === preset.key
                    ? "bg-ink border-ink text-on-dark hover:bg-panel-3"
                    : "text-muted hover:border-strong hover:bg-subtle hover:text-ink",
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="border-hairline bg-surface rounded-lg border p-3 sm:p-4">
            <DateRangeCalendar
              selected={draft}
              onSelect={handleDaySelect}
              defaultMonth={draft?.from ?? new Date()}
              numberOfMonths={showTwoMonths ? 2 : 1}
            />
          </div>

          <div
            className="border-hairline bg-subtle flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5"
            aria-live="polite"
          >
            <span className="text-body-xs text-ink flex items-center gap-2 font-medium">
              <CalendarDays aria-hidden="true" className="text-muted h-3.5 w-3.5" />
              {draftLabel ?? "No date selected"}
            </span>
            <span className="text-body-xs text-muted">{hint}</span>
          </div>
        </div>
      </Modal>
    </>
  );
}
