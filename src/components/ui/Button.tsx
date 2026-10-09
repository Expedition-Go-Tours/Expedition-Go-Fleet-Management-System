import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill font-ui font-medium uppercase tracking-[var(--tracking-ui)] transition-colors duration-150 ease-[var(--ease-standard)] disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "bg-ink text-on-dark hover:bg-panel-3",
        accent: "bg-accent text-on-dark hover:brightness-95",
        outline: "border border-strong bg-transparent text-ink hover:border-ink hover:bg-surface",
        inverse: "bg-white text-ink hover:bg-faint",
        ghost: "bg-transparent text-ink hover:bg-surface",
      },
      size: {
        sm: "h-9 px-4 text-[length:var(--fs-ui-xs)]",
        md: "h-11 px-6 text-[length:var(--fs-ui-sm)]",
        lg: "h-12 px-7 text-[length:var(--fs-ui-sm)]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { buttonVariants };
