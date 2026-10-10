"use client";

import "driver.js/dist/driver.css";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import { useOnboarding } from "@/components/onboarding/context";
import { TourController, type TourEndReason } from "@/components/onboarding/tourEngine";
import { visibleSteps } from "@/lib/onboarding/tours";
import type { TourDefinition, TourStep } from "@/lib/onboarding/types";

/**
 * Mounts and drives the active tour.
 *
 * Renders no markup of its own: Driver.js owns the overlay and popover. The
 * component supplies the two things Driver.js cannot know — the application's
 * real route (so a cross-route step navigates with the router and resumes once
 * the destination has rendered) and the employee's permissions (so steps their
 * role cannot use are never offered).
 */
export function TourRunner({
  tour,
  runId,
  permissions,
}: {
  tour: TourDefinition | null;
  runId: number;
  permissions: string[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { handleTourEnd } = useOnboarding();

  const permissionsKey = permissions.join("|");
  const steps: TourStep[] = useMemo(
    () => (tour ? visibleSteps(tour, permissionsKey ? permissionsKey.split("|") : []) : []),
    [tour, permissionsKey],
  );

  const pathnameRef = useRef(pathname);
  const routerRef = useRef(router);
  const onEndRef = useRef(handleTourEnd);
  const controllerRef = useRef<TourController | null>(null);

  // Mirrors the latest props into long-lived callbacks. Written in an effect,
  // never during render.
  useEffect(() => {
    routerRef.current = router;
    onEndRef.current = handleTourEnd;
  });

  // Create the controller for this run. Declared before the route-sync effect
  // so the controller exists before the first pathname effect fires.
  useEffect(() => {
    if (!tour) return;

    const controller = new TourController({
      getRoute: () => pathnameRef.current,
      navigate: (route) => routerRef.current.push(route),
      onEnd: (reason: TourEndReason) => {
        if (controllerRef.current === controller) controllerRef.current = null;
        onEndRef.current(tour, reason);
      },
    });
    controllerRef.current = controller;
    controller.start(steps);

    return () => {
      controller.teardown();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [tour, runId, steps]);

  // Route changes are what a cross-route step waits for: publish the new path,
  // then let the controller resume the step it parked before navigating.
  useEffect(() => {
    pathnameRef.current = pathname;
    controllerRef.current?.handleRouteChange();
  }, [pathname]);

  return null;
}
