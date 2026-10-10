"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Car, FileWarning, Loader2, Search, Wrench } from "lucide-react";

import type { SearchResponse, SearchHit } from "@/app/api/v1/search/route";
import { cn } from "@/lib/cn";
import { api } from "@/lib/client/api";

/*
 * Header global search. Opens a modal (Ctrl/Cmd+K or click), searches the
 * permission-aware /api/v1/search endpoint, supports arrow-key navigation and
 * Enter to open. Escape or overlay click closes.
 */

const GROUPS: {
  key: keyof Pick<SearchResponse, "vehicles" | "issues" | "workOrders">;
  label: string;
  icon: typeof Car;
}[] = [
  { key: "vehicles", label: "Vehicles", icon: Car },
  { key: "issues", label: "Issues", icon: FileWarning },
  { key: "workOrders", label: "Work orders", icon: Wrench },
];

export function GlobalSearch({ enableHotkey = true }: { enableHotkey?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enableHotkey) return;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enableHotkey]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Clear any in-flight debounce when the component unmounts.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Debounced search, driven by the typed query. The previous implementation
  // only ran once when the palette opened and read the input's DOM value, so it
  // never reacted to typing and returned no results for any query.
  function runSearch(value: string) {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = value.trim();
    setActive(0);
    if (q.length < 2) {
      setResults(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    timerRef.current = setTimeout(() => {
      api
        .get<SearchResponse>(`/api/v1/search?q=${encodeURIComponent(q)}`)
        .then((res) => {
          setResults(res);
          setActive(0);
        })
        .catch(() => setResults(null))
        .finally(() => setBusy(false));
    }, 180);
  }

  function close() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
    setResults(null);
    setBusy(false);
    setQuery("");
  }

  const flat: (SearchHit & { group: string })[] = [];
  if (results) {
    for (const group of GROUPS) {
      for (const hit of results[group.key] ?? []) {
        flat.push({ ...hit, group: group.key });
      }
    }
  }
  const total = flat.length;

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(total - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === "Enter" && total > 0) {
      event.preventDefault();
      const target = flat[Math.min(active, total - 1)];
      if (target) window.location.assign(target.href);
    }
  }

  return (
    <>
      <button
        type="button"
        data-tour="header-search"
        onClick={() => setOpen(true)}
        className="hover:bg-subtle focus-visible:outline-accent border-hairline text-body-sm text-muted bg-surface flex h-9 w-full items-center gap-2 rounded-md border px-3 transition-colors"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Search aria-hidden="true" className="h-4 w-4" />
        <span className="flex-1 text-left text-[var(--fs-body-xs)]">Search the fleet…</span>
        <kbd className="font-ui border-hairline text-faint rounded border px-1.5 py-0.5 text-[10px]">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 p-4 pt-[10vh]" role="presentation">
          <button
            type="button"
            aria-label="Close search"
            tabIndex={-1}
            onClick={close}
            className="absolute inset-0 h-full w-full cursor-default bg-black/45 backdrop-blur-[1px]"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
            className="bg-surface relative z-10 mx-auto flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-lg shadow-[var(--shadow-lg)]"
          >
            <div className="border-hairline border-b">
              <div className="flex items-center gap-2 px-4">
                <Search aria-hidden="true" className="text-faint h-4 w-4 shrink-0" />
                <input
                  ref={inputRef}
                  type="search"
                  value={query}
                  onChange={(e) => runSearch(e.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder="Vehicles, issues, work orders…"
                  className="placeholder:text-faint h-12 w-full bg-transparent text-sm outline-none"
                  aria-label="Search"
                  autoComplete="off"
                />
                {busy && (
                  <Loader2
                    aria-hidden="true"
                    className="text-faint h-4 w-4 shrink-0 animate-spin"
                  />
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              {!results && !busy && (
                <p className="text-muted px-4 py-6 text-center text-[var(--fs-body-xs)]">
                  Type at least two characters to search vehicles, issues and work orders.
                </p>
              )}
              {results && total === 0 && (
                <p className="text-muted px-4 py-6 text-center text-[var(--fs-body-xs)]">
                  No matches for “{results.query}”.
                </p>
              )}
              {results &&
                total > 0 &&
                GROUPS.map((group) => {
                  const hits = results[group.key] ?? [];
                  if (hits.length === 0) return null;
                  return (
                    <div key={group.key} className="mb-1">
                      <p className="font-ui text-faint px-4 py-1.5 text-[10px] font-semibold tracking-[var(--tracking-ui)] uppercase">
                        {group.label}
                      </p>
                      {hits.map((hit) => {
                        const index = flat.findIndex(
                          (f) => f.id === hit.id && f.group === group.key,
                        );
                        const selected = index === active;
                        return (
                          <Link
                            key={hit.id}
                            href={hit.href}
                            onClick={close}
                            onMouseEnter={() => setActive(index)}
                            className={cn(
                              "flex items-center gap-3 px-4 py-2.5",
                              selected ? "bg-subtle" : "hover:bg-subtle",
                            )}
                          >
                            <group.icon
                              aria-hidden="true"
                              className="text-faint h-4 w-4 shrink-0"
                            />
                            <span className="min-w-0">
                              <span className="text-data text-ink block truncate font-medium">
                                {hit.label}
                              </span>
                              <span className="text-data-xs text-muted block truncate">
                                {hit.sublabel}
                              </span>
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
