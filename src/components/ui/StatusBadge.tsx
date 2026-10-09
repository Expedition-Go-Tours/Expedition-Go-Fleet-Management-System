import { cn } from "@/lib/cn";

/*
 * Status pill used across all fleet screens. Colour is semantic but restrained:
 * green = healthy/settled, amber = needs attention, accent = urgent/active,
 * red = blocked/void, muted = inert.
 */

const TONES = {
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  accent: "border-accent/30 bg-accent/10 text-accent",
  danger: "border-error/25 bg-error/10 text-error",
  muted: "border-hairline bg-surface text-muted",
} as const;

export type StatusTone = keyof typeof TONES;

const STATUS_TONES: Record<string, StatusTone> = {
  // vehicles
  ACTIVE: "success",
  IN_SERVICE: "warning",
  SAFETY_HOLD: "accent",
  ARCHIVED: "muted",
  // reports
  OPEN: "accent",
  TRIAGED: "warning",
  CLOSED: "muted",
  // work orders
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  // expenses
  PENDING: "warning",
  APPROVED: "success",
  PAID: "success",
  VOID: "danger",
  // users
  INVITED: "muted",
  SUSPENDED: "danger",
  DISABLED: "danger",
  // audit outcomes
  SUCCESS: "success",
  FAILURE: "danger",
} as const;

export function StatusBadge({
  status,
  tone,
  className,
}: {
  status: string;
  tone?: StatusTone;
  className?: string;
}) {
  const resolved = tone ?? STATUS_TONES[status] ?? "muted";
  return (
    <span
      className={cn(
        "rounded-pill font-ui inline-flex items-center border px-2.5 py-0.5 text-[length:var(--fs-ui-xs)] font-medium tracking-[var(--tracking-ui)] uppercase",
        TONES[resolved],
        className,
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
