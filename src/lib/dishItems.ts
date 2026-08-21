import { GRAM_UNIT_ID, type Ingredient } from "@/types/nutrition";
import { getIngredient } from "@/lib/database";
import { findUnit, fromGrams, normalizeQuantity, toGrams } from "@/lib/units";
import type { DishItem } from "@/lib/storage/types";

/**
 * Building and editing a list of dish items.
 *
 * These are pure array transforms rather than store methods because the same
 * interaction exists in three places — the builder's Zustand store, the
 * "Build" tab of the assign dialog, and the auto-planner — and the two UI
 * copies had drifted into separate implementations of the same rules.
 */

/** A weighed ingredient starts at 100 g; a countable one starts at one piece. */
export const DEFAULT_GRAMS = 100;

/** Builds a dish item using the ingredient's most natural unit. */
export function makeItem(ingredient: Ingredient, grams?: number): DishItem {
  const unit = findUnit(ingredient, ingredient.defaultUnitId);

  if (typeof grams === "number") {
    return {
      ingredientId: ingredient.ingredient_id,
      name: ingredient.name,
      grams,
      unitId: unit.id,
      quantity: fromGrams(unit, grams),
    };
  }

  const quantity = unit.id === GRAM_UNIT_ID ? DEFAULT_GRAMS : 1;
  return {
    ingredientId: ingredient.ingredient_id,
    name: ingredient.name,
    grams: toGrams(unit, quantity),
    unitId: unit.id,
    quantity,
  };
}

/** Appends an ingredient, ignoring one that is already present. */
export function addItem(items: DishItem[], ingredient: Ingredient): DishItem[] {
  if (items.some((it) => it.ingredientId === ingredient.ingredient_id)) return items;
  return [...items, makeItem(ingredient)];
}

export function removeItem(items: DishItem[], ingredientId: string): DishItem[] {
  return items.filter((it) => it.ingredientId !== ingredientId);
}

export function setItemQuantity(
  items: DishItem[],
  ingredientId: string,
  quantity: number
): DishItem[] {
  return items.map((it) => {
    if (it.ingredientId !== ingredientId) return it;
    const unit = findUnit(getIngredient(ingredientId), it.unitId);
    const next = normalizeQuantity(unit, quantity);
    return { ...it, quantity: next, grams: toGrams(unit, next) };
  });
}

/** Switching units preserves the weight, so "100 g" becomes "2 large eggs". */
export function setItemUnit(
  items: DishItem[],
  ingredientId: string,
  unitId: string
): DishItem[] {
  return items.map((it) => {
    if (it.ingredientId !== ingredientId) return it;
    const unit = findUnit(getIngredient(ingredientId), unitId);
    const quantity = fromGrams(unit, it.grams);
    return { ...it, unitId, quantity, grams: toGrams(unit, quantity) };
  });
}
