import type { Config, DriveStep, Driver, Side, Alignment, AllowedButtons } from "driver.js";

import { normalizeRoute } from "@/lib/onboarding/tours";
import type { TourEndReason, TourStep } from "@/lib/onboarding/types";

export type { TourEndReason };

/**
 * Route-aware tour controller built on Driver.js.
 *
 * Driver.js owns the spotlight, the popover, smooth scrolling and keyboard
 * handling. This controller owns everything Driver.js cannot do:
 *
 *   • navigating between routes with the application's real router,
 *   • waiting for the destination page *and* the target control to render,
 *   • falling back to a responsive alternate target, or skipping a step the
 *     user's role or viewport does not show,
 *   • guaranteeing an exit path from every step, so a tour can never hang.
 *
 * Only ever imported from a `"use client"` component; `driver.js` itself is
 * loaded through a dynamic import, so nothing browser-dependent reaches the
 * server bundle or an SSR pass.
 */

/** How long to wait for a target control to appear on the current route. */
const TARGET_TIMEOUT_MS = 8000;
/** How long to wait for a route change before giving up and exiting. */
const ROUTE_TIMEOUT_MS = 15000;

export interface TourControllerHooks {
  /** Current pathname (no query/hash). */
  getRoute: () => string;
  /** Navigate with the application's real router. */
  navigate: (route: string) => void;
  /** Called exactly once when the tour ends, for any reason. */
  onEnd: (reason: TourEndReason) => void;
}

/** Strip anything that could break out of the attribute selector. */
export function tourSelector(target: string): string {
  const safe = target.replace(/[^a-zA-Z0-9_-]/g, "");
  return `[data-tour="${safe}"]`;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Visible means it has a real box and is not hidden by a parent or style. */
function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

let driverModule: Promise<typeof import("driver.js")> | null = null;
function loadDriver(): Promise<typeof import("driver.js")> {
  return (driverModule ??= import("driver.js"));
}

export class TourController {
  private steps: TourStep[] = [];
  private driver: Driver | null = null;
  private index = 0;
  private runToken = 0;
  private generation = 0;
  private ending = false;
  private pendingIndex: number | null = null;
  private navTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly hooks: TourControllerHooks) {}

  get active(): boolean {
    return this.steps.length > 0;
  }

  get currentIndex(): number {
    return this.index;
  }

  start(steps: TourStep[]): void {
    this.runToken += 1;
    this.steps = steps;
    this.ending = false;
    this.pendingIndex = null;
    this.clearNavTimer();
    // Deferred so a caller inside a React effect never sees a synchronous
    // state update (and so a stop() in the same tick wins over this run).
    queueMicrotask(() => this.show(0, this.runToken));
  }

  /** Exit and report the reason. Safe to call repeatedly. */
  end(reason: TourEndReason): void {
    if (this.ending) return;
    this.ending = true;
    this.runToken += 1;
    this.pendingIndex = null;
    this.clearNavTimer();
    this.destroyDriver();
    this.steps = [];
    this.hooks.onEnd(reason);
  }

  /** Exit without reporting — used when the host component unmounts. */
  teardown(): void {
    this.ending = true;
    this.runToken += 1;
    this.pendingIndex = null;
    this.clearNavTimer();
    this.destroyDriver();
    this.steps = [];
  }

  /** Called by the host whenever the pathname changes. */
  handleRouteChange(): void {
    if (this.pendingIndex === null) return;
    const index = this.pendingIndex;
    this.pendingIndex = null;
    this.clearNavTimer();
    const token = this.runToken;
    queueMicrotask(() => this.show(index, token));
  }

  private clearNavTimer(): void {
    if (this.navTimer !== null) {
      clearTimeout(this.navTimer);
      this.navTimer = null;
    }
  }

  private async show(index: number, token: number): Promise<void> {
    if (token !== this.runToken || this.ending) return;

    const steps = this.steps;
    if (index >= steps.length) {
      this.end("completed");
      return;
    }
    const safeIndex = Math.max(0, index);
    const step = steps[safeIndex];
    if (!step) {
      this.end("completed");
      return;
    }
    this.index = safeIndex;

    const route = normalizeRoute(step.route);
    if (route !== this.hooks.getRoute()) {
      // Hand control to the router; the pathname effect resumes this step.
      this.pendingIndex = safeIndex;
      this.hooks.navigate(route);
      this.navTimer = setTimeout(() => {
        if (this.pendingIndex !== null) this.end("stalled");
      }, ROUTE_TIMEOUT_MS);
      return;
    }

    const found = await this.resolveTarget(step, TARGET_TIMEOUT_MS);
    if (token !== this.runToken || this.ending) return;

    if (!found) {
      // Target missing (role-restricted, still loading, or a layout this
      // viewport does not show). Skip it rather than spotlight a dead hole.
      await this.show(safeIndex + 1, token);
      return;
    }

    await this.mount(safeIndex, found, token);
  }

  /**
   * Poll for the step's target, then any of its declared fallbacks.
   *
   * Presence alone is not enough: the sidebar link exists in the DOM on a
   * phone, but the drawer is closed, so spotlighting it would produce a
   * zero-size highlight. A target must also be *visible* — otherwise the next
   * fallback (e.g. the mobile menu button) wins, and if nothing is visible the
   * step is skipped rather than hung on.
   */
  private async resolveTarget(step: TourStep, timeoutMs: number): Promise<string | null> {
    const selectors = [step.target, ...(step.fallbacks ?? [])]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map(tourSelector);

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && isVisible(element)) return selector;
      }
      if (Date.now() >= deadline) return null;
      await delay(120);
    }
  }

  private async mount(index: number, selector: string, token: number): Promise<void> {
    const { driver } = await loadDriver();
    if (token !== this.runToken || this.ending) return;

    this.destroyDriver();
    const generation = this.generation;
    const instance = driver({
      ...this.config(generation),
      steps: this.buildSteps(index, selector),
    });
    this.driver = instance;
    try {
      instance.drive(index);
    } catch (error) {
      console.error("[onboarding] failed to highlight tour step", error);
      this.destroyDriver();
      await this.show(index + 1, token);
    }
  }

  private buildSteps(index: number, activeSelector: string): DriveStep[] {
    const total = this.steps.length;
    const showButtons: AllowedButtons[] = ["next", "previous", "close"];

    return this.steps.map((step, i) => {
      const disableButtons: AllowedButtons[] = i === 0 ? ["previous"] : [];
      const popover = {
        title: step.title,
        description: step.description,
        ...(step.side ? ({ side: step.side as Side } as const) : {}),
        ...(step.align ? ({ align: step.align as Alignment } as const) : {}),
        showProgress: true,
        progressText: `${i + 1} of ${total}`,
        nextBtnText: i === total - 1 ? "Finish tour" : "Next",
        prevBtnText: "Back",
        doneBtnText: "Finish tour",
        closeBtnLabel: "Skip tour",
        showButtons,
        disableButtons,
      };
      return {
        element: i === index ? activeSelector : tourSelector(step.target),
        data: { index: i },
        popover,
      } satisfies DriveStep;
    });
  }

  private config(generation: number): Config {
    return {
      animate: true,
      duration: 260,
      allowClose: true,
      allowScroll: true,
      smoothScroll: true,
      allowKeyboardControl: true,
      overlayColor: "#0c1016",
      overlayOpacity: 0.66,
      stagePadding: 8,
      stageRadius: 10,
      popoverOffset: 10,
      popoverClass: "egt-tour",
      overlayClickBehavior: "none",
      // The highlighted control is inert while it is being explained, so a
      // tour can never accidentally submit a form or mutate a record.
      disableActiveInteraction: true,
      skipMissingElement: false,
      showProgress: true,
      progressText: "1 of 1",
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Finish tour",
      closeBtnLabel: "Skip tour",
      showButtons: ["next", "previous", "close"],
      onNextClick: (_element, _step, opts) => this.moveBy(1, opts.index),
      onPrevClick: (_element, _step, opts) => this.moveBy(-1, opts.index),
      onCloseClick: () => this.end("dismissed"),
      // Driver.js intercepts Escape/close before tearing down, which gives us
      // one reliable exit point from every step of every tour.
      onDestroyStarted: () => this.end("dismissed"),
      onDestroyed: () => {
        if (this.generation === generation) this.driver = null;
      },
    };
  }

  private moveBy(delta: number, activeIndex: number | undefined): void {
    const from = activeIndex ?? this.index;
    const next = from + delta;
    if (delta > 0 && next >= this.steps.length) {
      this.end("completed");
      return;
    }
    if (next < 0) return;
    void this.show(next, this.runToken);
  }

  private destroyDriver(): void {
    this.generation += 1;
    const instance = this.driver;
    this.driver = null;
    if (!instance) return;
    try {
      instance.destroy();
    } catch {
      // Tearing down an already-torn-down instance is not user-facing.
    }
  }
}
