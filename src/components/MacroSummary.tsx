import type { Macros } from "@/types/nutrition";
import { macroEnergySplit } from "@/lib/calc";
import { formatMacroGrams, round0 } from "@/lib/format";

const MACRO_META: {
  key: keyof Macros;
  label: string;
  unit: string;
  decimals: 0 | 1;
  className: string;
}[] = [
  { key: "energy_kcal", label: "Calories", unit: "kcal", decimals: 0, className: "text-tomato" },
  { key: "protein_g", label: "Protein", unit: "g", decimals: 1, className: "text-basil" },
  { key: "carbs_g", label: "Carbs", unit: "g", decimals: 1, className: "text-gold" },
  { key: "fat_g", label: "Fat", unit: "g", decimals: 1, className: "text-tomato-dark" },
  { key: "fiber_g", label: "Fiber", unit: "g", decimals: 1, className: "text-charcoal-soft" },
];

function value(macros: Macros, key: keyof Macros, decimals: 0 | 1) {
  return decimals === 0 ? round0(macros[key]) : formatMacroGrams(macros[key]);
}

export default function MacroSummary({
  macros,
  totalGrams,
}: {
  macros: Macros;
  totalGrams?: number;
}) {
  const split = macroEnergySplit(macros);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {MACRO_META.map((m) => (
          <div
            key={m.key}
            className="rounded-xl border border-cream-deep bg-cream px-3 py-2.5 text-center"
          >
            <div className={`font-display text-2xl font-700 ${m.className}`}>
              {value(macros, m.key, m.decimals)}
            </div>
            <div className="text-[11px] font-600 uppercase tracking-wide text-charcoal-soft">
              {m.label}
              <span className="ml-1 font-500 lowercase tracking-normal opacity-70">
                {m.unit}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] font-600 uppercase tracking-wide text-charcoal-soft">
          <span>Energy split</span>
          {typeof totalGrams === "number" && (
            <span className="tabular-nums">{round0(totalGrams)} g total</span>
          )}
        </div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-cream-deep">
          <span className="bg-basil" style={{ width: `${split.proteinPct}%` }} />
          <span className="bg-gold" style={{ width: `${split.carbsPct}%` }} />
          <span className="bg-tomato-dark" style={{ width: `${split.fatPct}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-charcoal-soft">
          <span>P {Math.round(split.proteinPct)}%</span>
          <span>C {Math.round(split.carbsPct)}%</span>
          <span>F {Math.round(split.fatPct)}%</span>
        </div>
      </div>
    </div>
  );
}
