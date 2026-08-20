import type { Ingredient, Macros } from "@/types/nutrition";
import { getIngredient } from "@/lib/database";

export const EMPTY_MACROS: Macros = {
  energy_kcal: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: 0,
};

/**
 * Macros contributed by `grams` of an ingredient, following the database's own
 * calculation policy: quantity_g / 100 * macro_per_100g.
 */
export function perItemMacros(ingredient: Ingredient, grams: number): Macros {
  const factor = grams / 100;
  const m = ingredient.macros_per_100g;
  return {
    energy_kcal: m.energy_kcal * factor,
    protein_g: m.protein_g * factor,
    carbs_g: m.carbs_g * factor,
    fat_g: m.fat_g * factor,
    fiber_g: m.fiber_g * factor,
  };
}

export function addMacros(a: Macros, b: Macros): Macros {
  return {
    energy_kcal: a.energy_kcal + b.energy_kcal,
    protein_g: a.protein_g + b.protein_g,
    carbs_g: a.carbs_g + b.carbs_g,
    fat_g: a.fat_g + b.fat_g,
    fiber_g: a.fiber_g + b.fiber_g,
  };
}

export interface DishItemLike {
  ingredientId: string;
  grams: number;
}

/** Sum the macros of a list of dish items, resolving ingredients by id. */
export function sumDishMacros(items: DishItemLike[]): Macros {
  return items.reduce<Macros>((total, item) => {
    const ingredient = getIngredient(item.ingredientId);
    if (!ingredient) return total;
    return addMacros(total, perItemMacros(ingredient, item.grams));
  }, { ...EMPTY_MACROS });
}

/** Total edible weight of a dish, in grams. */
export function totalGrams(items: DishItemLike[]): number {
  return items.reduce((sum, item) => sum + (item.grams || 0), 0);
}

export interface MacroEnergySplit {
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
}

/**
 * Share of energy from each macronutrient using Atwater factors (4/4/9 kcal/g).
 * Returns zeros when there is no energy to split.
 */
export function macroEnergySplit(macros: Macros): MacroEnergySplit {
  const p = macros.protein_g * 4;
  const c = macros.carbs_g * 4;
  const f = macros.fat_g * 9;
  const total = p + c + f;
  if (total <= 0) return { proteinPct: 0, carbsPct: 0, fatPct: 0 };
  return {
    proteinPct: (p / total) * 100,
    carbsPct: (c / total) * 100,
    fatPct: (f / total) * 100,
  };
}
