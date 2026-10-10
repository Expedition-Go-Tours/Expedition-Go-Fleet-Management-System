import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type ContainerProps = {
  children: ReactNode;
  className?: string;
  /** `wide` relaxes the max width for dense data views. */
  size?: "default" | "wide";
};

export function Container({ children, className, size }: ContainerProps) {
  return <div className={cn(size === "wide" && "max-w-[1600px]", className)}>{children}</div>;
}
