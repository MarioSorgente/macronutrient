import type { Macros } from "@/types/nutrition";
import type { MacroTargets } from "@/lib/storage/types";

/**
 * How close a day has to be to count as hitting its target.
 *
 * Wide enough that the kitchen can actually serve it. The old window was ±3 %
 * on calories and ±4 g of fat — half a teaspoon of oil — and a day is graded on
 * all four at once, so a plate that was 5 g of fat away was "Best effort"
 * however good it was, and the search spent its whole budget hunting a
 * combination narrower than Negrita's own portioning.
 *
 * Calories are absolute rather than proportional on purpose: ±100 kcal is what
 * a person notices, at 1,600 as much as at 4,000, where a percentage quietly
 * gave big targets three times the room it gave small ones.
 */
export const DAILY_TOLERANCES: Record<
  DailyMacroKey,
  { kind: "absolute" | "percent"; amount: number }
> = {
  energy_kcal: { kind: "absolute", amount: 100 },
  protein_g: { kind: "absolute", amount: 6 },
  carbs_g: { kind: "absolute", amount: 6 },
  fat_g: { kind: "absolute", amount: 6 },
};

export const DAILY_MACRO_KEYS = [
  "energy_kcal", "protein_g", "carbs_g", "fat_g",
] as const satisfies readonly (keyof MacroTargets)[];

export type DailyMacroKey = (typeof DAILY_MACRO_KEYS)[number];
/** Precision used by the planner preview for each daily macro. */
export const DAILY_DISPLAY_DECIMALS: Record<DailyMacroKey, number> = {
  energy_kcal: 0, protein_g: 1, carbs_g: 1, fat_g: 1,
};
export type DailyAdherenceClassification =
  | "Exact"
  | "Within tolerance"
  | "Best effort"
  | "Impossible";
export type DailyFailureReason =
  | `${"energy" | "protein" | "carbs" | "fat"}_${"below" | "above"}_tolerance`
  | `no_eligible_${string}_candidates`
  | "kitchen_portion_increments_prevent_compliance"
  | "closest_available_combination_outside_tolerance"
  | "insufficient_eligible_candidates"
  | "restrictions_make_target_infeasible";

export interface DailyAdherenceReason {
  /** Stable, machine-readable identifier. Do not use the message for logic. */
  code: DailyFailureReason;
  /** Human-readable explanation suitable for a planner preview. */
  message: string;
}

export interface MacroAdherenceDiagnostic {
  actual: number;
  target: number;
  /** Actual minus target (positive means over target). */
  deviation: number;
  /** Alias with an explicit API name for consumers presenting diagnostics. */
  signedDeviation: number;
  tolerance: number;
  allowedTolerance: number;
  lower: number;
  upper: number;
  remaining: number;
  normalizedError: number;
  compliant: boolean;
  status: "pass" | "fail";
}

export interface DailyAdherenceDiagnostics {
  classification: DailyAdherenceClassification;
  compliant: boolean;
  normalizedError: number;
  macros: Record<DailyMacroKey, MacroAdherenceDiagnostic>;
  failureDimensions: DailyMacroKey[];
  reasonCodes: DailyFailureReason[];
  reasons: DailyAdherenceReason[];
}

const MACRO_LABELS: Record<DailyMacroKey, string> = {
  energy_kcal: "Calories", protein_g: "Protein", carbs_g: "Carbohydrates", fat_g: "Fat",
};

function reasonMessage(code: DailyFailureReason): string {
  if (code === "insufficient_eligible_candidates") return "No valid complete day can be formed from the eligible candidates.";
  if (code === "restrictions_make_target_infeasible") return "The enabled dietary restrictions make a complete day infeasible.";
  if (code === "kitchen_portion_increments_prevent_compliance") return "Kitchen portion increments prevent a compliant combination.";
  if (code === "closest_available_combination_outside_tolerance") return "This is the closest complete day the available meals can produce.";
  const slot = /^no_eligible_(.+)_candidates$/.exec(code)?.[1];
  if (slot) return `No eligible ${slot.replaceAll("_", " ")} candidates are available.`;
  const match = /^(energy|protein|carbs|fat)_(below|above)_tolerance$/.exec(code);
  const key = match?.[1] === "energy" ? "energy_kcal" : `${match?.[1]}_g` as DailyMacroKey;
  const label = MACRO_LABELS[key] ?? "Macro";
  return match?.[2] === "below"
    ? `${label} cannot reach its lower bound.`
    : `${label} cannot stay below its upper bound.`;
}

export function dailyTolerance(key: DailyMacroKey, target: number): number {
  const policy = DAILY_TOLERANCES[key];
  return policy.kind === "percent" ? Math.abs(target) * policy.amount : policy.amount;
}

/** Evaluate only a complete day's totals. Callers explicitly mark incomplete days. */
export function diagnoseDailyAdherence(
  actual: Macros,
  target: MacroTargets,
  options: {
    complete?: boolean;
    restrictionsApplied?: boolean;
    unavailableSlots?: string[];
    kitchenPortionsConstrained?: boolean;
  } = {}
): DailyAdherenceDiagnostics {
  const complete = options.complete ?? true;
  const entries = DAILY_MACRO_KEYS.map((key) => {
    const tolerance = dailyTolerance(key, target[key]);
    const error = actual[key] - target[key];
    return [key, {
      actual: actual[key], target: target[key], deviation: error, signedDeviation: error,
      tolerance, allowedTolerance: tolerance,
      lower: target[key] - tolerance, upper: target[key] + tolerance,
      remaining: -error,
      normalizedError: tolerance > 0 ? Math.abs(error) / tolerance : Math.abs(error),
      compliant: Math.abs(error) <= tolerance,
      status: Math.abs(error) <= tolerance ? "pass" : "fail",
    }] as const;
  });
  const macros = Object.fromEntries(entries) as DailyAdherenceDiagnostics["macros"];
  const failureDimensions = DAILY_MACRO_KEYS.filter((key) => !macros[key].compliant);
  const macroReasons = failureDimensions.map((key) => {
    const name = key === "energy_kcal" ? "energy" : key.replace("_g", "");
    const direction = macros[key].actual < macros[key].lower ? "below" : "above";
    return `${name}_${direction}_tolerance` as DailyFailureReason;
  });
  const compliant = complete && failureDimensions.length === 0;
  // "Exact" describes what a person sees, rather than floating-point noise
  // hidden beyond the precision used by the planner preview.
  const exact = complete && DAILY_MACRO_KEYS.every((key) => {
    const scale = 10 ** DAILY_DISPLAY_DECIMALS[key];
    return Math.round((actual[key] - target[key]) * scale) === 0;
  });
  // A cause is only named when it is known. `kitchenPortionsConstrained` is a
  // finding the caller has to establish — that a single serving step is wider
  // than the tolerance window — not an inference from "the day used a composed
  // meal". Everything else gets the honest generic reason instead of a guess.
  const reasonCodes: DailyFailureReason[] = complete
    ? [
        ...macroReasons,
        ...(macroReasons.length
          ? [options.kitchenPortionsConstrained
              ? "kitchen_portion_increments_prevent_compliance" as const
              : "closest_available_combination_outside_tolerance" as const]
          : []),
      ]
    : [
        "insufficient_eligible_candidates",
        ...(options.unavailableSlots ?? []).map((slot) =>
          `no_eligible_${slot.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}_candidates` as const),
        ...(options.restrictionsApplied ? ["restrictions_make_target_infeasible" as const] : []),
        ...macroReasons,
      ];

  return {
    classification: !complete ? "Impossible" : exact ? "Exact" : compliant ? "Within tolerance" : "Best effort",
    compliant,
    normalizedError:
      DAILY_MACRO_KEYS.reduce((sum, key) => sum + macros[key].normalizedError, 0) /
      DAILY_MACRO_KEYS.length,
    macros, failureDimensions, reasonCodes,
    reasons: reasonCodes.map((code) => ({ code, message: reasonMessage(code) })),
  };
}

/** Differences below this threshold are ties, allowing soft criteria to decide. */
export const MEANINGFUL_DAILY_ERROR_DIFFERENCE = 0.1;
