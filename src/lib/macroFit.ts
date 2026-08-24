import type { Macros } from "@/types/nutrition";
import type { MacroTargets } from "@/lib/storage/types";

/**
 * How far a set of macros sits from a target.
 *
 * Kept in its own module because both the whole-day solver and the DIY composer
 * need it, and the composer must not import the solver: the solver asks the
 * composer for candidates, never the other way round.
 *
 * Protein carries double weight because it is the macro people actually hold
 * themselves to; calories next; carbs and fat last, since they are the ones
 * that absorb the slack.
 */
export const MACRO_FIT_WEIGHTS = {
  protein: 2.0, energy: 1.2, carbs: 0.7, fat: 0.7,
} as const;

export function relativeMiss(actual: number, target: number): number {
  if (target <= 0) return actual > 0 ? 1 : 0;
  return Math.abs(actual - target) / target;
}

/** The same distance, in the flat form the composer's hot loops use. */
export function macroDistance(
  energyKcal: number, proteinG: number, carbsG: number, fatG: number,
  target: MacroTargets
): number {
  return (
    MACRO_FIT_WEIGHTS.protein * relativeMiss(proteinG, target.protein_g) +
    MACRO_FIT_WEIGHTS.energy * relativeMiss(energyKcal, target.energy_kcal) +
    MACRO_FIT_WEIGHTS.carbs * relativeMiss(carbsG, target.carbs_g) +
    MACRO_FIT_WEIGHTS.fat * relativeMiss(fatG, target.fat_g)
  );
}

export function scoreAgainst(macros: Macros, target: MacroTargets): number {
  return macroDistance(macros.energy_kcal, macros.protein_g, macros.carbs_g,
    macros.fat_g, target);
}

/** Daily macros still to be covered once the chosen meals are counted. */
export function remainingTarget(target: MacroTargets, macros: Macros): MacroTargets {
  return {
    energy_kcal: target.energy_kcal - macros.energy_kcal,
    protein_g: target.protein_g - macros.protein_g,
    carbs_g: target.carbs_g - macros.carbs_g,
    fat_g: target.fat_g - macros.fat_g,
  };
}
