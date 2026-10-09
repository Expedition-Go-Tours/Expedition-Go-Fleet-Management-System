import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/cn";

type DisplayTitleProps = {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  size?: "xl" | "lg" | "md";
};

const sizes = {
  xl: "text-display-xl",
  lg: "text-display-lg",
  md: "text-display-md",
} as const;

/** Tightly-tracked geometric display heading (Manrope). */
export function DisplayTitle({
  children,
  className,
  as: Tag = "h1",
  size = "lg",
}: DisplayTitleProps) {
  return (
    <Tag className={cn("font-heading font-semibold text-balance", sizes[size], className)}>
      {children}
    </Tag>
  );
}
