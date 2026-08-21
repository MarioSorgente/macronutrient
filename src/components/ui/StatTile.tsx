import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * One number with a label. Matches the macro tiles in MacroSummary so the
 * admin dashboard reads as the same product, not a bolted-on report.
 */
export default function StatTile({
  label,
  value,
  hint,
  tone = "charcoal",
  icon,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "charcoal" | "tomato" | "basil" | "gold";
  icon?: ReactNode;
  className?: string;
}) {
  const TONES = {
    charcoal: "text-charcoal",
    tomato: "text-tomato",
    basil: "text-basil",
    gold: "text-gold",
  } as const;

  return (
    <div
      className={cn(
        "rounded-xl2 border border-cream-deep bg-white/70 px-3 py-2.5 shadow-card",
        className
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-600 uppercase tracking-wide text-charcoal-soft">
        {icon}
        {label}
      </div>
      <div className={cn("mt-1 font-display text-2xl font-700 tabular-nums", TONES[tone])}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-charcoal-soft">{hint}</div>}
    </div>
  );
}
