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

const compactClassifications = {
  Exact: "Exact",
  "Within tolerance": "Within tol.",
  "Best effort": "Best effort",
  Impossible: "No plan",
} as const;

const compactLabels = {
  energy_kcal: "Cal",
  protein_g: "Pro",
  carbs_g: "Carb",
  fat_g: "Fat",
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
  const compactSummary = diagnostics.classification === "Exact"
    ? "All macros exact"
    : diagnostics.classification === "Within tolerance"
      ? "All macros OK"
      : diagnostics.classification === "Impossible"
        ? "Incomplete day"
        : `Out: ${diagnostics.failureDimensions.map((key) => compactLabels[key]).join(", ")}`;

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className={`rounded-lg border ${compact ? "px-2 py-1.5" : "px-3 py-2"} ${stateStyles[diagnostics.classification]}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className={compact ? "text-xs" : "text-sm"} title={compact ? diagnostics.classification : undefined}>
            {compact ? compactClassifications[diagnostics.classification] : diagnostics.classification}
          </strong>
          {targetSource && <span className="text-[11px] font-700">{compact ? "Tgt" : "Target"}: {compact && targetSource === "Explicit" ? "Exp." : targetSource}</span>}
        </div>
        <p className={compact ? "mt-0.5 text-[10px]" : "mt-0.5 text-xs"}>{compact ? compactSummary : explanation}</p>
        {!compact && diagnostics.reasons.length > 0 && diagnostics.classification !== "Within tolerance" && diagnostics.classification !== "Exact" && (
          <p className="mt-1 text-[11px]">{diagnostics.reasons.map((reason) => reason.message).join(" ")}</p>
        )}
      </div>
      <div className={compact ? "grid grid-cols-4 gap-1" : "grid grid-cols-2 gap-2 sm:grid-cols-4"}>
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
            <div key={field.key} className={`min-w-0 rounded-lg border border-cream-deep bg-white ${compact ? "px-1 py-1.5 text-center" : "px-2.5 py-2"}`}>
              <div className="truncate text-[10px] font-700 uppercase tracking-wide text-charcoal-soft" title={compact ? field.label : undefined}>{compact ? compactLabels[field.key] : field.label}</div>
              <div className={`${compact ? "mt-0.5 text-[11px]" : "mt-1 text-xs"} tabular-nums text-charcoal`}>
                <b>{format(item.actual)}</b>{!compact && " actual"}
              </div>
              <div className={`${compact ? "text-[9px]" : "text-[11px]"} tabular-nums text-charcoal-soft`}>{compact ? "/ " : ""}{format(item.target)} {!compact && `${field.unit} target`}</div>
              <div className={`mt-0.5 ${compact ? "text-[10px]" : "text-xs"} font-700 tabular-nums ${valueTone}`}>
                {signed}{!compact && ` ${field.unit}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
