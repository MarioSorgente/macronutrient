import type { MacroStyle, MacroTargets } from "@/lib/storage/types";

/** Modes accepted by target resolution. Explicit is selected automatically for a complete target. */
export type TargetMode = "Explicit" | "High protein" | "Balanced" | "Low carb" | "High carb" | "Auto";
export type DerivationStyle = Exclude<TargetMode, "Explicit">;

export interface TargetResolutionInput {
  /** A complete target is authoritative and is never normalised to its calories. */
  targets?: Partial<MacroTargets> | null;
  /** Auto (or an omitted style) resolves to Balanced. */
  style?: DerivationStyle | MacroStyle | null;
  /** Used only when targets does not contain a usable calorie value. */
  defaultEnergyKcal?: number;
}

export interface TargetResolution {
  target: MacroTargets;
  source: "explicit" | "derived";
  selectedStyle: TargetMode;
  explanation: string;
}

export const DEFAULT_DERIVED_ENERGY_KCAL = 2000;

const RULES = {
  "High protein": { protein: 0.35, carbs: 0.35, fat: 0.3 },
  Balanced: { protein: 0.25, carbs: 0.45, fat: 0.3 },
  "Low carb": { protein: 0.3, carbs: 0.15, fat: 0.55 },
  "High carb": { protein: 0.2, carbs: 0.55, fat: 0.25 },
} as const;

type ConcreteStyle = keyof typeof RULES;

const STYLE_NAMES: Record<MacroStyle, ConcreteStyle> = {
  high_protein: "High protein",
  balanced: "Balanced",
  low_carb: "Low carb",
  high_carb: "High carb",
};

function complete(targets: Partial<MacroTargets> | null | undefined): targets is MacroTargets {
  return Boolean(targets) && (["energy_kcal", "protein_g", "carbs_g", "fat_g"] as const)
    .every((key) => typeof targets?.[key] === "number" && Number.isFinite(targets[key]) && targets[key] >= 0);
}

function concreteStyle(style: TargetResolutionInput["style"]): ConcreteStyle {
  if (!style || style === "Auto") return "Balanced";
  if (style in STYLE_NAMES) return STYLE_NAMES[style as MacroStyle];
  return style as ConcreteStyle;
}

/**
 * Resolve the planner's single source of truth for daily targets.
 *
 * Style rules are energy shares (P/C/F respectively): High protein 35/35/30,
 * Balanced 25/45/30, Low carb 30/15/55, and High carb 20/55/25. Protein and
 * carbohydrate use 4 kcal/g and fat uses 9 kcal/g. Gram values deliberately
 * retain precision: rounding each macro independently would make their energy
 * disagree with the requested calories.
 */
export function resolveTarget(input: TargetResolutionInput = {}): TargetResolution {
  if (complete(input.targets)) {
    return {
      target: { ...input.targets },
      source: "explicit",
      selectedStyle: "Explicit",
      explanation: "Complete calorie, protein, carbohydrate, and fat targets were supplied; all four values are preserved exactly.",
    };
  }

  const style = concreteStyle(input.style);
  const split = RULES[style];
  const suppliedEnergy = input.targets?.energy_kcal;
  const energy = typeof suppliedEnergy === "number" && Number.isFinite(suppliedEnergy) && suppliedEnergy >= 0
    ? suppliedEnergy
    : input.defaultEnergyKcal ?? DEFAULT_DERIVED_ENERGY_KCAL;
  const target = {
    energy_kcal: energy,
    protein_g: (energy * split.protein) / 4,
    carbs_g: (energy * split.carbs) / 4,
    fat_g: (energy * split.fat) / 9,
  };
  const percentages = `${split.protein * 100}% protein, ${split.carbs * 100}% carbohydrate, and ${split.fat * 100}% fat`;
  return {
    target,
    source: "derived",
    selectedStyle: style,
    explanation: `${style} derives ${percentages} at 4/4/9 kcal per gram; unrounded grams reconcile exactly to ${energy} kcal.`,
  };
}
