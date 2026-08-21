import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** Toggleable pill — category filters, protein preferences, week numbers. */
export default function Chip({
  label,
  icon,
  active,
  onClick,
  className,
}: {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-600 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato-soft/60",
        active
          ? "border-tomato bg-tomato text-cream"
          : "border-cream-deep bg-white text-charcoal-soft hover:border-tomato-soft hover:text-charcoal",
        className
      )}
    >
      {icon}
      {label}
    </button>
  );
}
