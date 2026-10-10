"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { CompletionToast } from "@/components/onboarding/CompletionToast";
import { TourRunner } from "@/components/onboarding/TourRunner";
import { WelcomeModal } from "@/components/onboarding/WelcomeModal";
import { OnboardingContext, type OnboardingValue } from "@/components/onboarding/context";
import { api } from "@/lib/client/api";
import { availableTours, shouldShowWelcome, tourStatusLabel } from "@/lib/onboarding/tours";
import type { RoleKey } from "@/lib/auth/types";
import type {
  OnboardingState,
  TourDefinition,
  TourEndReason,
  TourId,
  TourProgress,
} from "@/lib/onboarding/types";

/**
 * Application-wide onboarding state.
 *
 * Mounted once around the shell (server-rendered by `AppShell`), so the header
 * Help menu, the welcome modal and the tour runner all share one source of
 * truth. Server state is loaded per employee; every change is written back to
 * `/api/v1/onboarding`, which scopes the record to the session user.
 *
 * The modal is decided in an effect (after mount) so server and client render
 * the same markup on first paint — no hydration mismatch, and it never blocks
 * navigation.
 */
export function OnboardingProvider({
  roles,
  permissions,
  initial,
  children,
}: {
  roles: RoleKey[];
  permissions: string[];
  initial: OnboardingState;
  children: ReactNode;
}) {
  const rolesKey = roles.join("|");
  const permissionsKey = permissions.join("|");
  const roleList = useMemo<RoleKey[]>(
    () => (rolesKey ? (rolesKey.split("|") as RoleKey[]) : []),
    [rolesKey],
  );
  const permissionList = useMemo(
    () => (permissionsKey ? permissionsKey.split("|") : []),
    [permissionsKey],
  );

  const tours = useMemo(() => availableTours(roleList, permissionList), [roleList, permissionList]);
  const recommended = tours[0] ?? null;
  const roleLabel = useMemo(
    () =>
      roleList.map((role) => role.charAt(0) + role.slice(1).toLowerCase()).join(" · ") ||
      "Team member",
    [roleList],
  );

  const [progress, setProgress] = useState<Partial<Record<TourId, TourProgress>>>(() => ({
    ...initial.tours,
  }));
  // `persist` runs from event handlers, where it must see the latest stored
  // status; the value is mirrored in an effect (never written during render).
  const progressRef = useRef(progress);
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  const [welcomeOpen, setWelcomeOpen] = useState<boolean>(
    () => Boolean(recommended) && shouldShowWelcome(initial.tours, recommended as TourDefinition),
  );
  const [helpOpen, setHelpOpenState] = useState(false);
  const [activeTour, setActiveTour] = useState<TourDefinition | null>(null);
  const [runId, setRunId] = useState(0);
  const [completion, setCompletion] = useState<TourDefinition | null>(null);
  const completionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setHelpOpen = useCallback((open: boolean) => setHelpOpenState(open), []);

  const dismissCompletion = useCallback(() => {
    setCompletion(null);
    if (completionTimer.current !== null) {
      clearTimeout(completionTimer.current);
      completionTimer.current = null;
    }
  }, []);

  const persist = useCallback(async (tour: TourDefinition, status: TourProgress["status"]) => {
    // Never downgrade a completed tour: skipping a replay must not make the
    // welcome experience reappear on the next sign-in.
    const existing = progressRef.current[tour.id];
    const alreadyComplete = existing?.status === "COMPLETED" && existing.version >= tour.version;
    const nextStatus: TourProgress["status"] =
      status === "COMPLETED" || alreadyComplete ? "COMPLETED" : "DISMISSED";

    const updatedAt = new Date().toISOString();
    setProgress((previous) => ({
      ...previous,
      [tour.id]: { status: nextStatus, version: tour.version, updatedAt },
    }));

    try {
      await api.post("/api/v1/onboarding", {
        tourId: tour.id,
        status: nextStatus,
        version: tour.version,
      });
    } catch (error) {
      // The tour itself already worked; a failed write only defers the
      // record to the next successful session.
      console.error("[onboarding] failed to persist tour state", error);
    }
  }, []);

  const startTour = useCallback(
    (tourId: TourId) => {
      const tour = tours.find((candidate) => candidate.id === tourId);
      if (!tour) return;
      setHelpOpen(false);
      setWelcomeOpen(false);
      dismissCompletion();
      setActiveTour(tour);
      setRunId((id) => id + 1);
    },
    [tours, setHelpOpen, dismissCompletion],
  );

  const startFromWelcome = useCallback(() => {
    setWelcomeOpen(false);
    if (recommended) startTour(recommended.id);
  }, [recommended, startTour]);

  const dismissWelcome = useCallback(() => {
    setWelcomeOpen(false);
    if (recommended) void persist(recommended, "DISMISSED");
  }, [recommended, persist]);

  const handleTourEnd = useCallback(
    (tour: TourDefinition, reason: TourEndReason) => {
      setActiveTour(null);
      dismissCompletion();
      if (reason === "completed") {
        setCompletion(tour);
        completionTimer.current = setTimeout(() => {
          completionTimer.current = null;
          setCompletion(null);
        }, 9000);
      }
      void persist(tour, reason === "completed" ? "COMPLETED" : "DISMISSED");
    },
    [persist, dismissCompletion],
  );

  // Clear the auto-dismiss timer if the shell unmounts mid-countdown.
  useEffect(
    () => () => {
      if (completionTimer.current !== null) clearTimeout(completionTimer.current);
    },
    [],
  );

  const statusFor = useCallback(
    (tour: TourDefinition) => tourStatusLabel(progress, tour),
    [progress],
  );

  const value = useMemo<OnboardingValue>(
    () => ({
      tours,
      recommended,
      roleLabel,
      progress,
      welcomeOpen,
      activeTour,
      helpOpen,
      completion,
      setHelpOpen,
      dismissWelcome,
      startFromWelcome,
      startTour,
      handleTourEnd,
      dismissCompletion,
      statusFor,
    }),
    [
      tours,
      recommended,
      roleLabel,
      progress,
      welcomeOpen,
      activeTour,
      helpOpen,
      completion,
      setHelpOpen,
      dismissWelcome,
      startFromWelcome,
      startTour,
      handleTourEnd,
      dismissCompletion,
      statusFor,
    ],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      <TourRunner tour={activeTour} runId={runId} permissions={permissionList} />
      <WelcomeModal />
      {completion && <CompletionToast title={completion.title} onClose={dismissCompletion} />}
    </OnboardingContext.Provider>
  );
}
