import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export type BadgeTone = "neutral" | "estimate" | "verified" | "warning" | "danger" | "info";

/**
 * Small status label. `estimate` is the gold "est" marker the app uses wherever
 * a macro is derived rather than measured — that distinction is load-bearing
 * here, so it gets a named tone rather than an ad-hoc colour at each call site.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: "bg-cream-deep text-charcoal-soft",
  estimate: "bg-gold/20 text-gold",
  verified: "bg-basil/15 text-basil",
  warning: "bg-gold/20 text-charcoal",
  danger: "bg-tomato-soft/30 text-tomato-dark",
  info: "bg-tomato-soft/25 text-tomato-dark",
};

export default function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-700 uppercase tracking-wide",
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
