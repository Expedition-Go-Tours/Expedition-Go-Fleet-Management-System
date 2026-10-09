import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/cn";

/** Small uppercase mono label used above headings, in table headers and status rows. */
export function Eyebrow({
  children,
  className,
  as: Tag = "span",
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
}) {
  return (
    <Tag
      className={cn(
        "font-ui text-muted text-[length:var(--fs-ui-xs)] font-medium tracking-[var(--tracking-ui)] uppercase",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
