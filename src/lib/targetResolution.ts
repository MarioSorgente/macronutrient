import type { MacroStyle, MacroTargets, TargetMode as StoredTargetMode } from "@/lib/storage/types";
import { formatPercentageShare } from "@/lib/format";

/** Modes accepted by target resolution. Explicit is selected automatically for a complete target. */
export type TargetMode = "Explicit" | "High protein" | "Balanced" | "Low carb / high fat" | "High carb" | "Auto";
export type DerivationStyle = Exclude<TargetMode, "Explicit">;

export interface TargetResolutionInput {
  /** A complete target is authoritative and is never normalised to its calories. */
  targets?: Partial<MacroTargets> | null;
  /** Explicit persisted mode. When omitted, legacy behavior is used for callers. */
  mode?: StoredTargetMode | null;
  /** Active preset, used only in preset mode. */
  preset?: MacroStyle | null;
  /** Auto (or an omitted style) resolves to Balanced. */
  style?: DerivationStyle | MacroStyle | null;
  /** Used only when targets does not contain a usable calorie value. */
  defaultEnergyKcal?: number;
}

export interface TargetResolution {
  target: MacroTargets;
  source: "explicit" | "derived";
  selectedStyle: TargetMode;
  /**
   * Whether the calorie figure was supplied or is the documented default. Auto
   * is a fixed, predictable fallback — never a guess at what this person needs.
   */
  energySource: "supplied" | "default";
  explanation: string;
}

export interface MacroTargetValidation {
  valid: boolean;
  macroEnergyKcal: number;
  differenceKcal: number;
  differencePercent: number;
}

/** Menu labels and decimal rounding may account for 50 kcal or 5%, whichever is larger. */
export function validateMacroTarget(target: MacroTargets): MacroTargetValidation {
  const macroEnergyKcal = target.protein_g * 4 + target.carbs_g * 4 + target.fat_g * 9;
  const differenceKcal = macroEnergyKcal - target.energy_kcal;
  const differencePercent = target.energy_kcal > 0
    ? Math.abs(differenceKcal) / target.energy_kcal * 100
    : (macroEnergyKcal === 0 ? 0 : Number.POSITIVE_INFINITY);
  return {
    valid: Math.abs(differenceKcal) <= Math.max(50, target.energy_kcal * 0.05),
    macroEnergyKcal,
    differenceKcal,
    differencePercent,
  };
}

/** Re-state a target at a new calorie level while retaining its energy proportions. */
export function scaleTargetEnergy(target: MacroTargets, energyKcal: number): MacroTargets {
  const represented = validateMacroTarget(target).macroEnergyKcal;
  if (!(represented > 0)) return resolveTarget({ targets: { energy_kcal: energyKcal } }).target;
  const scale = energyKcal / represented;
  return {
    energy_kcal: energyKcal,
    protein_g: target.protein_g * scale,
    carbs_g: target.carbs_g * scale,
    fat_g: target.fat_g * scale,
  };
}

export const DEFAULT_DERIVED_ENERGY_KCAL = 2000;

const RULES = {
  "High protein": { protein: 0.35, carbs: 0.35, fat: 0.3 },
  Balanced: { protein: 0.25, carbs: 0.45, fat: 0.3 },
  "Low carb / high fat": { protein: 0.3, carbs: 0.15, fat: 0.55 },
  "High carb": { protein: 0.2, carbs: 0.55, fat: 0.25 },
} as const;

type ConcreteStyle = keyof typeof RULES;

const STYLE_NAMES: Record<MacroStyle, ConcreteStyle> = {
  high_protein: "High protein",
  balanced: "Balanced",
  low_carb: "Low carb / high fat",
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
 * Balanced 25/45/30, Low carb / high fat 30/15/55, and High carb 20/55/25. Protein and
 * carbohydrate use 4 kcal/g and fat uses 9 kcal/g. Gram values deliberately
 * retain precision: rounding each macro independently would make their energy
 * disagree with the requested calories.
 */
export function resolveTarget(input: TargetResolutionInput = {}): TargetResolution {
  const explicitMode = input.mode === "custom";
  const presetMode = input.mode === "preset";
  if (explicitMode || (!presetMode && complete(input.targets))) {
    const target = complete(input.targets)
      ? { ...input.targets }
      : resolveTarget({ targets: input.targets, mode: "preset", preset: "balanced",
          defaultEnergyKcal: input.defaultEnergyKcal }).target;
    return {
      target,
      source: "explicit",
      selectedStyle: "Explicit",
      energySource: "supplied",
      explanation: "Complete calorie, protein, carbohydrate, and fat targets were supplied; all four values are preserved exactly.",
    };
  }

  const style = concreteStyle(input.preset ?? input.style);
  const split = RULES[style];
  const suppliedEnergy = input.targets?.energy_kcal;
  // Auto resolves deterministically to Balanced at the documented default
  // calorie figure. There is no height, weight, age or activity data here, so
  // there is nothing to personalise from and nothing is invented: the number is
  // a stated default a person can then edit, not an estimate of their needs.
  const hasSuppliedEnergy = typeof suppliedEnergy === "number" &&
    Number.isFinite(suppliedEnergy) && suppliedEnergy >= 0;
  const energy = hasSuppliedEnergy
    ? suppliedEnergy
    : input.defaultEnergyKcal ?? DEFAULT_DERIVED_ENERGY_KCAL;
  const target = {
    energy_kcal: energy,
    protein_g: (energy * split.protein) / 4,
    carbs_g: (energy * split.carbs) / 4,
    fat_g: (energy * split.fat) / 9,
  };
  const percentages = `${formatPercentageShare(split.protein)} protein, ${formatPercentageShare(split.carbs)} carbohydrate, and ${formatPercentageShare(split.fat)} fat`;
  return {
    target,
    source: "derived",
    selectedStyle: style,
    energySource: hasSuppliedEnergy ? "supplied" : "default",
    explanation: `${style} derives ${percentages} at 4/4/9 kcal per gram; unrounded grams reconcile exactly to ${energy} kcal${
      hasSuppliedEnergy ? "" : ", the default used when no calorie target is given"}.`,
  };
}
