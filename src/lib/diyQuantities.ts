import { perItemMacros } from "@/lib/calc";
import type { DiyMenuItem, DiyQuantityMetadata, Ingredient, Macros } from "@/types/nutrition";
import type { MacroTargets } from "@/lib/storage/types";

const FIXED_PORTION = /\bpcs?\b|\bslice\b/i;

/**
 * Operational serving metadata for each DIY line. Defaults are deliberately
 * section-specific; the overrides record kitchen-approved staple sequences.
 */
export function diyQuantityMetadata(item: DiyMenuItem): DiyQuantityMetadata {
  const fixed = FIXED_PORTION.test(item.name);
  if (fixed) return { minimum_g: item.portion_g, maximum_g: item.portion_g,
    preferred_g: item.portion_g, increment_g: item.portion_g,
    arbitrary_quantities_supported: false };

  const sectionDefaults: Record<DiyMenuItem["section"], Omit<DiyQuantityMetadata,
    "preferred_g">> = {
    protein: { minimum_g: 100, maximum_g: 250, increment_g: 25,
      arbitrary_quantities_supported: true },
    carbs: { minimum_g: 50, maximum_g: 300, increment_g: 25,
      arbitrary_quantities_supported: true },
    veg: { minimum_g: 30, maximum_g: 300, increment_g: 10,
      arbitrary_quantities_supported: true },
    fats: { minimum_g: 10, maximum_g: 120, increment_g: 5,
      arbitrary_quantities_supported: true },
  };
  const overrides: Record<string, Partial<DiyQuantityMetadata>> = {
    chicken_breast_raw: { minimum_g: 100, maximum_g: 200, increment_g: 25 },
    chicken_teriyaki_negrita: { minimum_g: 100, maximum_g: 200, increment_g: 25 },
    chicken_mushroom_negrita: { minimum_g: 100, maximum_g: 200, increment_g: 25 },
    chicken_peri_peri_negrita: { minimum_g: 100, maximum_g: 200, increment_g: 25 },
    rice_jasmine_cooked_proxy: { minimum_g: 100, maximum_g: 300, increment_g: 50 },
  };
  const defaults = sectionDefaults[item.section];
  return { ...defaults, minimum_g: Math.min(defaults.minimum_g, item.portion_g),
    maximum_g: Math.max(defaults.maximum_g, item.portion_g), preferred_g: item.portion_g,
    ...overrides[item.ingredient_id] };
}

export function snapDiyQuantity(quantity: number, metadata: DiyQuantityMetadata): number {
  if (!metadata.arbitrary_quantities_supported) return metadata.preferred_g;
  const bounded = Math.min(metadata.maximum_g, Math.max(metadata.minimum_g, quantity));
  const steps = Math.round((bounded - metadata.minimum_g) / metadata.increment_g);
  return Math.min(metadata.maximum_g,
    Math.max(metadata.minimum_g, metadata.minimum_g + steps * metadata.increment_g));
}

const KEYS = ["energy_kcal", "protein_g", "carbs_g", "fat_g"] as const;

/** Least-squares optimum for one ingredient, immediately made kitchen-real. */
export function optimalDiyQuantity(ingredient: Ingredient, residual: MacroTargets): number {
  const metadata = ingredient.diy_quantity;
  if (!metadata) throw new Error(`${ingredient.ingredient_id} has no DIY quantity metadata`);
  if (!metadata.arbitrary_quantities_supported) return metadata.preferred_g;
  const perGram = perItemMacros(ingredient, 1);
  let numerator = 0;
  let denominator = 0;
  for (const key of KEYS) {
    const scale = Math.max(Math.abs(residual[key]), key === "energy_kcal" ? 100 : 10);
    numerator += perGram[key] * residual[key] / (scale * scale);
    denominator += perGram[key] * perGram[key] / (scale * scale);
  }
  const theoretical = denominator > 0 ? numerator / denominator : metadata.preferred_g;
  return snapDiyQuantity(theoretical, metadata);
}

/** A small local neighborhood, not an enumeration of the whole gram range. */
export function quantitiesNearResidual(ingredient: Ingredient, residual: MacroTargets): number[] {
  const metadata = ingredient.diy_quantity;
  if (!metadata) return [];
  const optimum = optimalDiyQuantity(ingredient, residual);
  if (!metadata.arbitrary_quantities_supported) return [optimum];
  return [...new Set([optimum - metadata.increment_g, optimum, optimum + metadata.increment_g]
    .map((value) => snapDiyQuantity(value, metadata)))];
}

/** Recalculate nutrition from the snapped, achievable quantity. */
export function snappedDiyMacros(ingredient: Ingredient, quantity: number): { grams: number; macros: Macros } {
  if (!ingredient.diy_quantity) throw new Error("ingredient is not a DIY item");
  const grams = snapDiyQuantity(quantity, ingredient.diy_quantity);
  return { grams, macros: perItemMacros(ingredient, grams) };
}
