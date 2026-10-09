import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type ContainerProps = {
  children: ReactNode;
  className?: string;
  /** `wide` relaxes the max width for dense data views. */
  size?: "default" | "wide";
};

export function Container({ children, className, size = "default" }: ContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-6",
        size === "wide" ? "max-w-[1600px]" : "max-w-[1440px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
