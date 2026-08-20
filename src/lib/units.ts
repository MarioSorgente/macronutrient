import {
  GRAM_UNIT,
  GRAM_UNIT_ID,
  type Ingredient,
  type PortionUnit,
} from "@/types/nutrition";

/**
 * Grams are authoritative for every macro calculation. A portion unit is only a
 * multiplier applied at the input surface, so staff can enter "2 eggs" instead
 * of "100 g" without changing how anything is computed.
 */

export function unitsFor(ingredient: Ingredient | undefined): PortionUnit[] {
  return ingredient?.units?.length ? ingredient.units : [GRAM_UNIT];
}

export function findUnit(
  ingredient: Ingredient | undefined,
  unitId: string
): PortionUnit {
  return unitsFor(ingredient).find((u) => u.id === unitId) ?? GRAM_UNIT;
}

/** Convert an amount expressed in `unit` into grams. */
export function toGrams(unit: PortionUnit, quantity: number): number {
  const grams = quantity * unit.gramWeight;
  return Number.isFinite(grams) && grams > 0 ? grams : 0;
}

/** Convert grams into an amount expressed in `unit`. */
export function fromGrams(unit: PortionUnit, grams: number): number {
  if (unit.gramWeight <= 0) return 0;
  const quantity = grams / unit.gramWeight;
  return unit.integerOnly
    ? Math.max(1, Math.round(quantity))
    : Number(quantity.toFixed(2));
}

/** Step size for the +/- controls: whole units for countables, else grams. */
export function stepFor(unit: PortionUnit): number {
  if (unit.id === GRAM_UNIT_ID) return 10;
  return unit.integerOnly ? 1 : 0.5;
}

/** Enforce whole numbers for countable units. */
export function normalizeQuantity(unit: PortionUnit, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity < 0) return 0;
  return unit.integerOnly ? Math.round(quantity) : quantity;
}

/** True when the ingredient offers something beyond plain grams. */
export function hasPortionUnits(ingredient: Ingredient | undefined): boolean {
  return unitsFor(ingredient).length > 1;
}
