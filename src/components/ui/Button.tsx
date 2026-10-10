import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/cn";

/*
 * Primary/secondary/destructive/text buttons. Normal case, restrained radii,
 * consistent heights. `accent` (warm orange) is reserved for the single
 * primary action on a screen; `primary` (ink) for the default action;
 * `danger` for destructive actions.
 */

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[color,background-color,border-color,box-shadow] duration-150 ease-[var(--ease-standard)] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  {
    variants: {
      variant: {
        primary: "bg-ink text-on-dark hover:bg-panel-3",
        accent: "bg-accent text-on-dark hover:bg-accent-strong",
        secondary:
          "border-hairline bg-surface text-ink shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:bg-subtle hover:border-strong",
        outline: "border-strong border bg-transparent text-ink hover:bg-subtle",
        ghost: "bg-transparent text-ink hover:bg-surface",
        danger: "bg-error text-on-dark hover:brightness-90",
        inverse: "bg-white text-ink hover:bg-faint",
      },
      size: {
        xs: "h-8 px-3 text-[length:var(--fs-body-xs)]",
        sm: "h-9 px-3.5 text-[length:var(--fs-body-xs)]",
        md: "h-10 px-4 text-[length:var(--fs-body-sm)]",
        lg: "h-11 px-5 text-[length:var(--fs-body-sm)]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Shows a small spinner and disables the button while true. */
  isLoading?: boolean;
  children?: ReactNode;
}

export function Button({
  className,
  variant,
  size,
  type = "button",
  isLoading,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled ?? isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading && (
        <svg
          className="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-90"
            fill="currentColor"
            d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends VariantProps<typeof buttonVariants> {
  href: string;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  onClick?: () => void;
  prefetch?: boolean;
}

/** Link styled exactly like a Button (same variants/sizes). */
export function ButtonLink({
  href,
  className,
  variant,
  size,
  children,
  prefetch,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </Link>
  );
}

export { buttonVariants };