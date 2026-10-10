"use client";

import { CircleCheck, Compass, Map } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useOnboarding } from "@/components/onboarding/context";

/**
 * First-run welcome experience. Shown once per tour version to an employee who
 * has neither completed nor postponed their tour — never on ordinary
 * navigation. Dismissing it is non-blocking and still leaves a permanent entry
 * point in the header Help menu.
 */
export function WelcomeModal() {
  const { welcomeOpen, recommended, roleLabel, dismissWelcome, startFromWelcome } = useOnboarding();

  if (!recommended) return null;

  const covers = recommended.steps.length;

  return (
    <Modal
      open={welcomeOpen}
      onClose={dismissWelcome}
      title="Welcome to Expedition Go Tours"
      description="Your fleet workspace, in two minutes."
      footer={
        <>
          <Button variant="ghost" size="md" onClick={dismissWelcome}>
            Maybe later
          </Button>
          <Button variant="accent" size="md" onClick={startFromWelcome}>
            Start guided tour
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5" data-tour="welcome-modal">
        <div className="flex flex-wrap items-center gap-2">
          <span className="border-hairline bg-subtle text-ink rounded-pill font-ui border px-2.5 py-1 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
            {roleLabel}
          </span>
          <span className="text-muted font-ui text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
            {recommended.title}
          </span>
        </div>

        <p className="text-body-sm text-ink">
          This workspace is where Expedition Go Tours keeps every vehicle, trip, inspection, repair
          and cost on one record. What you enter here is the fleet&apos;s official history — so
          anyone picking up after you can see exactly what happened.
        </p>

        <ul className="border-hairline bg-subtle flex flex-col gap-3 rounded-lg border p-4">
          <li className="flex items-start gap-2.5">
            <Map aria-hidden="true" className="text-accent mt-0.5 h-4 w-4 shrink-0" />
            <span className="text-body-xs text-ink">
              A {covers}-step walkthrough of the {recommended.title.toLowerCase()} — your dashboard,
              the controls you will use day to day, and where to find help.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <Compass aria-hidden="true" className="text-accent mt-0.5 h-4 w-4 shrink-0" />
            <span className="text-body-xs text-ink">
              It only explains things — nothing is submitted, saved or changed while you watch.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <CircleCheck aria-hidden="true" className="text-accent mt-0.5 h-4 w-4 shrink-0" />
            <span className="text-body-xs text-ink">
              Skip it and nothing is lost: the tour stays available from the Help menu in the header
              whenever you want it.
            </span>
          </li>
        </ul>
      </div>
    </Modal>
  );
}
