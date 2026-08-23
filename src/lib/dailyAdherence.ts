import type { Macros } from "@/types/nutrition";
import type { MacroTargets } from "@/lib/storage/types";

export const DAILY_TOLERANCES = {
  energy_kcal: { kind: "percent", amount: 0.02 },
  protein_g: { kind: "absolute", amount: 4 },
  carbs_g: { kind: "absolute", amount: 5 },
  fat_g: { kind: "absolute", amount: 3 },
} as const;

export const DAILY_MACRO_KEYS = [
  "energy_kcal", "protein_g", "carbs_g", "fat_g",
] as const satisfies readonly (keyof MacroTargets)[];

export type DailyMacroKey = (typeof DAILY_MACRO_KEYS)[number];
export type DailyAdherenceClassification =
  | "Exact"
  | "Within tolerance"
  | "Best effort"
  | "Impossible";
export type DailyFailureReason =
  | `${"energy" | "protein" | "carbs" | "fat"}_${"below" | "above"}_tolerance`
  | "insufficient_eligible_candidates"
  | "restrictions_make_target_infeasible";

export interface MacroAdherenceDiagnostic {
  actual: number;
  target: number;
  tolerance: number;
  lower: number;
  upper: number;
  remaining: number;
  normalizedError: number;
  compliant: boolean;
}

export interface DailyAdherenceDiagnostics {
  classification: DailyAdherenceClassification;
  compliant: boolean;
  normalizedError: number;
  macros: Record<DailyMacroKey, MacroAdherenceDiagnostic>;
  failureDimensions: DailyMacroKey[];
  reasonCodes: DailyFailureReason[];
}

export function dailyTolerance(key: DailyMacroKey, target: number): number {
  const policy = DAILY_TOLERANCES[key];
  return policy.kind === "percent" ? Math.abs(target) * policy.amount : policy.amount;
}

/** Evaluate only a complete day's totals. Callers explicitly mark incomplete days. */
export function diagnoseDailyAdherence(
  actual: Macros,
  target: MacroTargets,
  options: { complete?: boolean; restrictionsApplied?: boolean } = {}
): DailyAdherenceDiagnostics {
  const complete = options.complete ?? true;
  const entries = DAILY_MACRO_KEYS.map((key) => {
    const tolerance = dailyTolerance(key, target[key]);
    const error = actual[key] - target[key];
    return [key, {
      actual: actual[key], target: target[key], tolerance,
      lower: target[key] - tolerance, upper: target[key] + tolerance,
      remaining: -error,
      normalizedError: tolerance > 0 ? Math.abs(error) / tolerance : Math.abs(error),
      compliant: Math.abs(error) <= tolerance,
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
  const exact = complete && DAILY_MACRO_KEYS.every(
    (key) => Math.abs(actual[key] - target[key]) <= 1e-6
  );
  const reasonCodes: DailyFailureReason[] = complete
    ? macroReasons
    : [
        "insufficient_eligible_candidates",
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
  };
}

/** Differences below this threshold are ties, allowing soft criteria to decide. */
export const MEANINGFUL_DAILY_ERROR_DIFFERENCE = 0.1;
