import type { Macros } from "@/types/nutrition";
import type { MacroTargets } from "@/lib/storage/types";
import { TARGET_FIELDS } from "@/lib/clients";
import { round0, round1 } from "@/lib/format";
import {
  diagnoseDailyAdherence,
  type DailyAdherenceDiagnostics,
} from "@/lib/dailyAdherence";

const stateStyles = {
  Exact: "border-basil/40 bg-basil/10 text-basil",
  "Within tolerance": "border-basil/40 bg-basil/10 text-basil",
  "Best effort": "border-gold/50 bg-gold/10 text-charcoal",
  Impossible: "border-tomato bg-tomato/10 text-tomato-dark",
} as const;

/** Complete-day compliance. Meals may show macros elsewhere, but are never graded. */
export default function TargetAdherence({
  actual,
  targets,
  complete = true,
  diagnostics: suppliedDiagnostics,
  targetSource,
  compact = false,
}: {
  actual: Macros;
  targets: MacroTargets;
  complete?: boolean;
  diagnostics?: DailyAdherenceDiagnostics;
  targetSource?: string;
  compact?: boolean;
}) {
  const diagnostics = suppliedDiagnostics ?? diagnoseDailyAdherence(actual, targets, { complete });
  const explanation = diagnostics.classification === "Best effort"
    ? "This is the closest complete day available, but one or more daily targets are outside tolerance."
    : diagnostics.classification === "Impossible"
      ? "A complete day could not be formed under the current meal and restriction constraints."
      : diagnostics.classification === "Exact"
        ? "All four daily values match their targets exactly."
        : "All four daily values are within tolerance.";

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className={`rounded-lg border px-3 py-2 ${stateStyles[diagnostics.classification]}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-sm">{diagnostics.classification}</strong>
          {targetSource && <span className="text-[11px] font-700">Target: {targetSource}</span>}
        </div>
        <p className="mt-0.5 text-xs">{explanation}</p>
        {diagnostics.reasons.length > 0 && diagnostics.classification !== "Within tolerance" && diagnostics.classification !== "Exact" && (
          <p className="mt-1 text-[11px]">{diagnostics.reasons.map((reason) => reason.message).join(" ")}</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TARGET_FIELDS.map((field) => {
          const item = diagnostics.macros[field.key];
          const format = field.key === "energy_kcal" ? round0 : round1;
          const deviation = format(item.signedDeviation);
          const signed = item.signedDeviation > 0 ? `+${deviation}` : `${deviation}`;
          const valueTone = diagnostics.classification === "Exact" || diagnostics.classification === "Within tolerance"
            ? "text-basil"
            : diagnostics.classification === "Impossible"
              ? "text-tomato-dark"
              : "text-gold";
          return (
            <div key={field.key} className="rounded-lg border border-cream-deep bg-white px-2.5 py-2">
              <div className="text-[10px] font-700 uppercase tracking-wide text-charcoal-soft">{field.label}</div>
              <div className="mt-1 text-xs tabular-nums text-charcoal">
                <b>{format(item.actual)}</b> actual
              </div>
              <div className="text-[11px] tabular-nums text-charcoal-soft">{format(item.target)} {field.unit} target</div>
              <div className={`mt-0.5 text-xs font-700 tabular-nums ${valueTone}`}>
                {signed} {field.unit}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
