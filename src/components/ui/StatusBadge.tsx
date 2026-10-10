import { cn } from "@/lib/cn";

/*
 * Status and severity indicator. Two shapes:
 *  - pill (default): bordered chip used in lists/tables.
 *  - dot: compact dot + label used in dense rows and summary blocks.
 * Colour is semantic: green = healthy/settled, amber = needs attention,
 * orange/accent = urgent/active, red = blocked/void, blue = informational,
 * muted = inert.
 */

const TONES = {
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  accent: "border-accent/30 bg-accent/10 text-accent",
  danger: "border-error/25 bg-error/10 text-error",
  info: "border-info/20 bg-info/10 text-info",
  muted: "border-hairline bg-surface text-muted",
} as const;

export type StatusTone = keyof typeof TONES;

const DOT_TONES: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  accent: "bg-accent",
  danger: "bg-error",
  info: "bg-info",
  muted: "bg-faint",
};

const STATUS_TONES: Record<string, StatusTone> = {
  // vehicles
  ACTIVE: "success",
  IN_SERVICE: "warning",
  SAFETY_HOLD: "danger",
  ARCHIVED: "muted",
  // reports
  OPEN: "accent",
  TRIAGED: "info",
  CLOSED: "muted",
  // issue severities
  CRITICAL: "danger",
  HIGH: "warning",
  MEDIUM: "info",
  LOW: "muted",
  // work orders
  IN_PROGRESS: "info",
  WAITING: "warning",
  COMPLETED: "success",
  VERIFIED: "success",
  // work order priorities
  NORMAL: "muted",
  URGENT: "danger",
  // expenses
  RECORDED: "success",
  VOID: "danger",
  // users
  INVITED: "info",
  SUSPENDED: "danger",
  DISABLED: "danger",
  // audit outcomes
  SUCCESS: "success",
  FAILURE: "danger",
  // odometer ledger
  ACCEPTED: "success",
  FLAGGED: "warning",
  SUPERSEDED: "muted",
  // maintenance schedule states
  OK: "success",
  DUE_SOON: "warning",
  DUE: "accent",
  OVERDUE: "danger",
  NOT_CONFIGURED: "muted",
  // documents
  VALID: "success",
  EXPIRING_SOON: "warning",
  EXPIRED: "danger",
  MISSING: "danger",
  // assignments
  CANCELLED: "muted",
  // inspections
  PASS: "success",
  FAIL: "danger",
  NA: "muted",
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
        "rounded-pill font-ui inline-flex items-center border px-2.5 py-0.5 text-[length:var(--fs-ui-xs)] font-medium tracking-[var(--tracking-ui)] whitespace-nowrap uppercase",
        TONES[resolved],
        className,
      )}
    >
      {formatStatusLabel(status)}
    </span>
  );
}

export function StatusDot({
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
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", DOT_TONES[resolved])} />
      <span className="font-ui text-ink-2 text-[length:var(--fs-data-xs)] font-medium tracking-[var(--tracking-ui)] uppercase">
        {formatStatusLabel(status)}
      </span>
    </span>
  );
}

/** "SAFETY_HOLD" → "Safety hold"; "DUE_SOON" → "Due soon". */
export function formatStatusLabel(status: string): string {
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export { TONES, STATUS_TONES };
