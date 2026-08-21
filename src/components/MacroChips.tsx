import type { ReactNode } from "react";
import type { Macros } from "@/types/nutrition";
import { round0, round1 } from "@/lib/format";
import { cn } from "@/components/ui/cn";

const SIZES = {
  xxs: "text-[11px]",
  xs: "text-xs",
  sm: "text-sm",
} as const;

/**
 * The one-line "480 kcal · P 32 · C 40 · F 12" readout.
 *
 * This shape appeared in seven components, each written separately, which is
 * why the gram suffix and the emphasis on calories had already drifted apart
 * between them. Calories lead in tomato because that is the number people scan
 * for first.
 */
export default function MacroChips({
  macros,
  size = "xs",
  variant = "spaced",
  tone = "soft",
  gramSuffix,
  showFiber,
  className,
  children,
}: {
  macros: Macros;
  size?: keyof typeof SIZES;
  /** `spaced` = separate spans; `dots` = a single interpunct-joined line. */
  variant?: "spaced" | "dots";
  /** `soft` for secondary readouts, `strong` when the figures are the content. */
  tone?: "soft" | "strong";
  /** Append "g" to the macro figures. */
  gramSuffix?: boolean;
  showFiber?: boolean;
  className?: string;
  /** Trailing extras such as a price or a "/100 g" qualifier. */
  children?: ReactNode;
}) {
  const g = gramSuffix ? "g" : "";
  const toneClass = tone === "strong" ? "text-charcoal" : "text-charcoal-soft";

  if (variant === "dots") {
    return (
      <div className={cn(SIZES[size], "tabular-nums", toneClass, className)}>
        {round0(macros.energy_kcal)} kcal · P {round1(macros.protein_g)}
        {g} · C {round1(macros.carbs_g)}
        {g} · F {round1(macros.fat_g)}
        {g}
        {showFiber && <> · Fiber {round1(macros.fiber_g)}{g}</>}
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums",
        toneClass,
        SIZES[size],
        className
      )}
    >
      <span>
        <b className="font-700 text-tomato">{round0(macros.energy_kcal)}</b> kcal
      </span>
      <span>P {round1(macros.protein_g)}{g}</span>
      <span>C {round1(macros.carbs_g)}{g}</span>
      <span>F {round1(macros.fat_g)}{g}</span>
      {showFiber && <span>Fiber {round1(macros.fiber_g)}{g}</span>}
      {children}
    </div>
  );
}
