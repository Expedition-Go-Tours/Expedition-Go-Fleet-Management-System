"use client";

import { ReactLenis, type LenisRef } from "lenis/react";
import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Application-wide smooth-scroll provider.
 *
 * Wraps the page in Lenis (lenis/react) for a subtle, professional scrolling
 * experience. The implementation is deliberately conservative — this is a
 * data-heavy fleet-operations dashboard where usability and fast record
 * navigation take priority over animation.
 *
 * Design decisions:
 *   • `lerp: 0.1` — a tight interpolation so scrolling feels responsive, not
 *     floaty.  Staff scanning vehicle tables or work-order lists should not
 *     have to wait for inertia to settle.
 *   • `smoothWheel: true` — smooth mouse-wheel / track-pad input on desktop.
 *   • Touch input uses native momentum scrolling (Lenis default). iOS/Android
 *     already provide excellent physics; explicitly enabling `syncTouch` would
 *     fight with the OS and make fast flicking feel sluggish.
 *   • `gestureOrientation: "vertical"` — prevents Lenis from hijacking
 *     horizontal swipes inside data tables and carousels.
 *   • `autoRaf: true` — delegates the animation loop to Lenis, avoiding a
 *     manual requestAnimationFrame lifecycle.
 *   • `data-lenis-prevent` on nested scroll containers (sidebar nav, table
 *     wrappers, search results, notification popovers, modals) so their
 *     native overflow scrolling is never intercepted.
 *   • `prefers-reduced-motion` — disables Lenis smoothing entirely when the
 *     user has requested reduced motion, falling back to native scroll.
 *
 * CSS: the required `lenis.css` is imported in globals.css so the Lenis
 * classes (`html.lenis`, `[data-lenis-prevent]` overscroll rules) are
 * available before first paint.
 */

const motionQuery =
  typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

function reducedMotionSubscribe(callback: () => void) {
  const mql = motionQuery;
  if (!mql) return () => {};
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function reducedMotionSnapshot(): boolean {
  return motionQuery?.matches ?? false;
}

export default function SmoothScroll() {
  const lenisRef = useRef<LenisRef>(null);

  // Subscribe to prefers-reduced-motion without triggering cascading renders.
  // useSyncExternalStore handles SSR (returns false) and re-renders only when
  // the preference actually changes.
  const reducedMotion = useSyncExternalStore(
    reducedMotionSubscribe,
    reducedMotionSnapshot,
    () => false,
  );

  // When a Driver.js onboarding tour is active the body carries the
  // `driver-active` class. Pause Lenis so the tour's own smooth-scroll
  // and stage animations are not interfered with.
  useEffect(() => {
    const lenis = lenisRef.current?.lenis;
    if (!lenis) return;

    const observer = new MutationObserver(() => {
      const tourActive = document.body.classList.contains("driver-active");
      if (tourActive) {
        lenis.stop();
      } else {
        lenis.start();
      }
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Sync on first check in case a tour is already running.
    if (document.body.classList.contains("driver-active")) {
      lenis.stop();
    }

    return () => observer.disconnect();
  }, []);

  // When reduced motion is preferred, disable smoothing but keep Lenis
  // initialised so programmatic `scrollTo` calls still work.
  if (reducedMotion) {
    return (
      <ReactLenis
        ref={lenisRef}
        autoRaf
        options={{
          smoothWheel: false,
          gestureOrientation: "vertical",
        }}
      />
    );
  }

  return (
    <ReactLenis
      ref={lenisRef}
      autoRaf
      options={{
        smoothWheel: true,
        lerp: 0.1,
        gestureOrientation: "vertical",
        wheelMultiplier: 1,
        touchMultiplier: 1,
      }}
    />
  );
}
