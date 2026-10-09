import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { Eyebrow } from "@/components/ui/Eyebrow";

/** Hairline-bordered panel used for page sections and data groups. */
export function Card({
  children,
  className,
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <section className={cn("border-hairline bg-page rounded-xl border", className)}>
      {(title || action) && (
        <header className="border-hairline flex items-center justify-between gap-4 border-b px-5 py-4">
          {title && <Eyebrow>{title}</Eyebrow>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
