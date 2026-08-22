import { describe, expect, it } from "vitest";
import {
  ZERO_PRICE,
  addPrices,
  formatIdr,
  formatPrice,
  portionsFor,
  priceForGrams,
  priceItems,
} from "@/lib/pricing";
import { getIngredient } from "@/lib/database";
import type { Ingredient } from "@/types/nutrition";

/**
 * Pricing. The kitchen sells whole portions, so 100 g out of a 200 g portion
 * still costs a full portion — and anything not on the DIY menu has no price
 * at all rather than a silently-omitted zero.
 *
 * `submitOrder` charges the customer with this code, so a rounding error here
 * is money.
 */

/** Real DIY lines: 200 g @ Rp 65,000 and 250 g @ Rp 25,000. */
const BUCKWHEAT = "buckwheat_cooked";
const SWEET_POTATO = "sweet_potato_baked";
/**
 * In the database but never on the DIY menu, so it carries no price at all.
 * (chicken_breast_raw looks unpriced but is not — it is sold as the 150 g
 * "Grilled Organic Free-Range Chicken with Herbs" line at Rp 30,000.)
 */
const UNPRICED = "apple_raw";

function ing(id: string): Ingredient {
  const found = getIngredient(id);
  if (!found) throw new Error(`fixture ${id} is missing`);
  return found;
}

describe("portionsFor", () => {
  it("charges a whole portion for any part of one", () => {
    const buckwheat = ing(BUCKWHEAT); // 200 g portion
    expect(portionsFor(buckwheat, 1)).toBe(1);
    expect(portionsFor(buckwheat, 100)).toBe(1);
    expect(portionsFor(buckwheat, 200)).toBe(1);
    expect(portionsFor(buckwheat, 201)).toBe(2);
    expect(portionsFor(buckwheat, 400)).toBe(2);
  });

  it("is zero for zero or negative grams", () => {
    expect(portionsFor(ing(BUCKWHEAT), 0)).toBe(0);
    expect(portionsFor(ing(BUCKWHEAT), -50)).toBe(0);
  });

  it("is zero for an ingredient with no DIY portion size", () => {
    expect(portionsFor(ing(UNPRICED), 100)).toBe(0);
  });
});

describe("priceForGrams", () => {
  it("prices whole portions", () => {
    expect(priceForGrams(ing(BUCKWHEAT), 200)).toBe(65_000);
    expect(priceForGrams(ing(BUCKWHEAT), 201)).toBe(130_000);
  });

  it("is null — not zero — for an ingredient Negrita does not sell", () => {
    // The distinction matters: zero would quietly understate a total.
    expect(priceForGrams(ing(UNPRICED), 100)).toBeNull();
    expect(priceForGrams(undefined, 100)).toBeNull();
  });
});

describe("priceItems", () => {
  it("totals priced items and reports them complete", () => {
    const result = priceItems([
      { ingredientId: BUCKWHEAT, grams: 200 },
      { ingredientId: SWEET_POTATO, grams: 250 },
    ]);
    expect(result.totalIdr).toBe(90_000);
    expect(result.unpricedCount).toBe(0);
    expect(result.complete).toBe(true);
  });

  it("counts unpriced items separately instead of dropping them", () => {
    const result = priceItems([
      { ingredientId: BUCKWHEAT, grams: 200 },
      { ingredientId: UNPRICED, grams: 150 },
    ]);
    expect(result.totalIdr).toBe(65_000);
    expect(result.unpricedCount).toBe(1);
    expect(result.complete).toBe(false);
  });

  it("is a complete zero for an empty set", () => {
    expect(priceItems([])).toEqual(ZERO_PRICE);
  });
});

describe("addPrices", () => {
  it("adds totals and stays incomplete if either side was", () => {
    const a = { totalIdr: 10_000, unpricedCount: 0, complete: true };
    const b = { totalIdr: 5_000, unpricedCount: 2, complete: false };
    expect(addPrices(a, b)).toEqual({
      totalIdr: 15_000,
      unpricedCount: 2,
      complete: false,
    });
  });

  it("keeps a complete sum complete", () => {
    expect(addPrices(ZERO_PRICE, ZERO_PRICE)).toEqual(ZERO_PRICE);
  });
});

describe("formatIdr", () => {
  it("uses a dot as the thousands separator", () => {
    expect(formatIdr(65_000)).toBe("Rp 65.000");
    expect(formatIdr(1_250_000)).toBe("Rp 1.250.000");
    expect(formatIdr(0)).toBe("Rp 0");
  });

  it("rounds to whole rupiah", () => {
    expect(formatIdr(65_000.4)).toBe("Rp 65.000");
  });
});

describe("formatPrice", () => {
  it("shows an exact total when everything is priced", () => {
    expect(formatPrice({ totalIdr: 65_000, unpricedCount: 0, complete: true }))
      .toBe("Rp 65.000");
  });

  it("shows a floor when part of the set has no price", () => {
    expect(formatPrice({ totalIdr: 65_000, unpricedCount: 1, complete: false }))
      .toBe("from Rp 65.000");
  });

  it("shows a dash when nothing in the set is priced at all", () => {
    expect(formatPrice({ totalIdr: 0, unpricedCount: 3, complete: false }))
      .toBe("—");
  });
});
