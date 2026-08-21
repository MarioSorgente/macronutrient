import type { Ingredient } from "@/types/nutrition";
import { getIngredient } from "@/lib/database";

/**
 * Pricing from Negrita's DIY menu.
 *
 * The kitchen sells fixed portions, so cost is counted in whole portions: 100 g
 * taken from a 200 g rice portion still costs one portion. Anything not on the
 * DIY menu has no price, and the app says so rather than inventing one.
 */

export interface PriceResult {
  /** Total in full rupiah across the items that are priced. */
  totalIdr: number;
  /** How many items had no price at all. */
  unpricedCount: number;
  /** True when every item in the set is priced. */
  complete: boolean;
}

/** Number of whole DIY portions needed to cover `grams`. */
export function portionsFor(ingredient: Ingredient, grams: number): number {
  const portion = ingredient.diy_portion_g;
  if (!portion || portion <= 0 || grams <= 0) return 0;
  return Math.ceil(grams / portion);
}

/** Cost of `grams` of an ingredient, or null when it is not sold as a component. */
export function priceForGrams(
  ingredient: Ingredient | undefined,
  grams: number
): number | null {
  if (!ingredient || typeof ingredient.price_idr !== "number") return null;
  return portionsFor(ingredient, grams) * ingredient.price_idr;
}

export interface PriceableItem {
  ingredientId: string;
  grams: number;
}

/**
 * Cost of a set of dish items. Reports unpriced items separately so the UI can
 * show "from Rp X" instead of a total that silently omits components.
 */
export function priceItems(items: PriceableItem[]): PriceResult {
  let totalIdr = 0;
  let unpricedCount = 0;

  for (const item of items) {
    const price = priceForGrams(getIngredient(item.ingredientId), item.grams);
    if (price === null) {
      unpricedCount += 1;
    } else {
      totalIdr += price;
    }
  }

  return { totalIdr, unpricedCount, complete: unpricedCount === 0 };
}

/** Add two price results (e.g. rolling a day up from meals). */
export function addPrices(a: PriceResult, b: PriceResult): PriceResult {
  const unpricedCount = a.unpricedCount + b.unpricedCount;
  return {
    totalIdr: a.totalIdr + b.totalIdr,
    unpricedCount,
    complete: unpricedCount === 0,
  };
}

export const ZERO_PRICE: PriceResult = {
  totalIdr: 0,
  unpricedCount: 0,
  complete: true,
};

/** Indonesian rupiah formatting: Rp 65.000 (dot as thousands separator). */
export function formatIdr(amount: number): string {
  return `Rp ${Math.round(amount).toLocaleString("de-DE")}`;
}

/**
 * Price label that stays honest when part of a set is unpriced: an exact total
 * when everything is priced, a "from" figure when it is not.
 */
export function formatPrice(price: PriceResult): string {
  if (price.unpricedCount > 0 && price.totalIdr === 0) return "—";
  return price.complete
    ? formatIdr(price.totalIdr)
    : `from ${formatIdr(price.totalIdr)}`;
}
