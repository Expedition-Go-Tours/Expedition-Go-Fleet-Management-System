import { createContext, useContext } from "react";

import type { TourEndReason, TourDefinition, TourId, TourProgress } from "@/lib/onboarding/types";

/**
 * Client-side onboarding contract shared by the shell (Help menu), the welcome
 * modal and the tour runner. Provided once by `OnboardingProvider`, which is
 * mounted around the application shell so every header control can reach it.
 */
export interface OnboardingValue {
  /** Tours this employee's roles *and* permissions actually allow. */
  tours: TourDefinition[];
  /** Tour this employee is offered first (drives the welcome modal). */
  recommended: TourDefinition | null;
  /** Human-readable role list for the welcome experience. */
  roleLabel: string;
  /** Persisted per-tour state for this employee. */
  progress: Partial<Record<TourId, TourProgress>>;
  /** True while the first-run welcome modal is open. */
  welcomeOpen: boolean;
  /** Tour currently running, or null. */
  activeTour: TourDefinition | null;
  /** Help menu open state (header button). */
  helpOpen: boolean;
  /** "Tour complete" confirmation, shown briefly after a finished tour. */
  completion: TourDefinition | null;

  setHelpOpen: (open: boolean) => void;
  /** "Maybe later" — postpones without blocking the app. */
  dismissWelcome: () => void;
  /** "Start guided tour" from the welcome modal. */
  startFromWelcome: () => void;
  /** Launch or replay a tour from the Help menu. */
  startTour: (tourId: TourId) => void;
  /** Called by the runner when a tour ends for any reason. */
  handleTourEnd: (tour: TourDefinition, reason: TourEndReason) => void;
  /** Dismiss the completion confirmation. */
  dismissCompletion: () => void;
  /** Short human status for the Help menu ("Completed", "Not started"). */
  statusFor: (tour: TourDefinition) => string;
}

export const OnboardingContext = createContext<OnboardingValue | null>(null);

export function useOnboarding(): OnboardingValue {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error("useOnboarding must be used inside <OnboardingProvider>");
  return value;
}
