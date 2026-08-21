import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

/**
 * The four button treatments the app already used, written once. `primary` is
 * tomato-on-cream for the single main action of a screen; `secondary` is the
 * bordered white pill; `ghost` is the icon-only affordance in a row; `danger`
 * is the confirmed-destructive state.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-tomato text-cream hover:bg-tomato-dark",
  secondary:
    "border border-cream-deep bg-white text-charcoal hover:border-tomato-soft",
  ghost: "text-charcoal-soft hover:bg-cream-deep hover:text-charcoal",
  danger: "bg-tomato-dark text-cream hover:bg-tomato",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs font-600",
  md: "px-4 py-2 text-sm font-600",
};

export default function Button({
  variant = "secondary",
  size = "md",
  icon,
  fullWidth,
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon, rendered at a size that matches the label. */
  icon?: ReactNode;
  fullWidth?: boolean;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-xl transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato-soft/60",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/** Square icon-only button — same treatments, no label, requires aria-label. */
export function IconButton({
  variant = "ghost",
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  children: ReactNode;
  "aria-label": string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "grid place-items-center rounded-lg p-1.5 transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato-soft/60",
        variant === "danger"
          ? "text-charcoal-soft hover:bg-tomato-soft/30 hover:text-tomato-dark"
          : VARIANTS[variant],
        className
      )}
    >
      {children}
    </button>
  );
}
