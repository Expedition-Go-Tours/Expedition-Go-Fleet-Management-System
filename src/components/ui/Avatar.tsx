import { cn } from "@/lib/cn";

/** Initials avatar — no external image dependency. */
export function Avatar({
  name,
  className,
  tone = "neutral",
}: {
  name: string;
  className?: string;
  tone?: "neutral" | "accent" | "dark";
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  const tones = {
    neutral: "bg-subtle border-hairline text-ink border",
    accent: "bg-accent/10 text-accent",
    dark: "bg-panel-2 text-on-dark",
  } as const;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[length:var(--fs-data-xs)] font-semibold",
        tones[tone],
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}