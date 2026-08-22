import { describe, expect, it } from "vitest";
import {
  EMPTY_MACROS,
  addMacros,
  houseRecipeMacrosPer100g,
  macroEnergySplit,
  perItemMacros,
  scaleMacros,
  sumDishMacros,
  totalGrams,
} from "@/lib/calc";
import { getIngredient } from "@/lib/database";
import type { Ingredient } from "@/types/nutrition";

/**
 * The macro engine. `submitOrder` runs this exact code server-side to price and
 * total an order, so an error here is a wrong bill, not a wrong pixel.
 */

/** Real database record: 106 kcal / 22.5 P / 0 C / 1.93 F per 100 g. */
const CHICKEN = "chicken_breast_raw";

function ingredient(id: string): Ingredient {
  const found = getIngredient(id);
  if (!found) throw new Error(`fixture ${id} is missing from the database`);
  return found;
}

describe("perItemMacros", () => {
  it("follows the database's own rule: grams / 100 * per-100 g", () => {
    const m = perItemMacros(ingredient(CHICKEN), 150);
    expect(m.energy_kcal).toBeCloseTo(159, 6); // 106 * 1.5
    expect(m.protein_g).toBeCloseTo(33.75, 6); // 22.5 * 1.5
    expect(m.carbs_g).toBeCloseTo(0, 6);
    expect(m.fat_g).toBeCloseTo(2.895, 6);
  });

  it("returns zeros for a zero-gram item rather than NaN", () => {
    const m = perItemMacros(ingredient(CHICKEN), 0);
    expect(m).toEqual(EMPTY_MACROS);
  });

  it("scales linearly, so 2x100 g equals 1x200 g", () => {
    const single = perItemMacros(ingredient(CHICKEN), 200);
    const doubled = addMacros(
      perItemMacros(ingredient(CHICKEN), 100),
      perItemMacros(ingredient(CHICKEN), 100)
    );
    expect(doubled.energy_kcal).toBeCloseTo(single.energy_kcal, 6);
    expect(doubled.protein_g).toBeCloseTo(single.protein_g, 6);
  });
});

describe("sumDishMacros", () => {
  it("skips an ingredient that is no longer in the database", () => {
    // A dish saved before an ingredient was renamed must still total the rest
    // rather than throwing or contributing NaN.
    const total = sumDishMacros([
      { ingredientId: CHICKEN, grams: 100 },
      { ingredientId: "not_a_real_ingredient", grams: 500 },
    ]);
    expect(total.energy_kcal).toBeCloseTo(106, 6);
    expect(Number.isNaN(total.protein_g)).toBe(false);
  });

  it("is zero for an empty dish", () => {
    expect(sumDishMacros([])).toEqual(EMPTY_MACROS);
  });

  it("does not mutate EMPTY_MACROS across calls", () => {
    sumDishMacros([{ ingredientId: CHICKEN, grams: 100 }]);
    sumDishMacros([{ ingredientId: CHICKEN, grams: 100 }]);
    expect(EMPTY_MACROS.energy_kcal).toBe(0);
  });
});

describe("totalGrams", () => {
  it("sums item weights and tolerates a missing grams field", () => {
    expect(
      totalGrams([
        { ingredientId: "a", grams: 100 },
        { ingredientId: "b", grams: 0 },
        { ingredientId: "c", grams: NaN as unknown as number },
      ])
    ).toBe(100);
  });
});

describe("houseRecipeMacrosPer100g", () => {
  it("concentrates a batch that reduced while cooking", () => {
    // 1000 g of chicken reducing to a 500 g finished batch is twice as dense.
    const per100 = houseRecipeMacrosPer100g(
      [{ ingredientId: CHICKEN, grams: 1000 }],
      500
    );
    expect(per100?.energy_kcal).toBeCloseTo(212, 6); // 106 * 2
    expect(per100?.protein_g).toBeCloseTo(45, 6);
  });

  it("is the identity when the finished weight equals the raw weight", () => {
    const per100 = houseRecipeMacrosPer100g(
      [{ ingredientId: CHICKEN, grams: 250 }],
      250
    );
    expect(per100?.energy_kcal).toBeCloseTo(106, 6);
  });

  it.each([
    ["zero", 0],
    ["negative", -100],
    ["not a number", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("returns null for a %s yield rather than dividing by it", (_label, yieldGrams) => {
    expect(
      houseRecipeMacrosPer100g([{ ingredientId: CHICKEN, grams: 100 }], yieldGrams)
    ).toBeNull();
  });

  it("returns null when the recipe has no components", () => {
    expect(houseRecipeMacrosPer100g([], 500)).toBeNull();
  });
});

describe("scaleMacros", () => {
  it("multiplies every field, including a half serving", () => {
    const scaled = scaleMacros(
      { energy_kcal: 100, protein_g: 10, carbs_g: 20, fat_g: 5, fiber_g: 2 },
      0.5
    );
    expect(scaled).toEqual({
      energy_kcal: 50,
      protein_g: 5,
      carbs_g: 10,
      fat_g: 2.5,
      fiber_g: 1,
    });
  });
});

describe("macroEnergySplit", () => {
  it("uses Atwater factors, so the three shares total 100", () => {
    // 25 P (100 kcal) + 25 C (100 kcal) + 100/9 F (100 kcal) = even thirds.
    const split = macroEnergySplit({
      energy_kcal: 300,
      protein_g: 25,
      carbs_g: 25,
      fat_g: 100 / 9,
      fiber_g: 0,
    });
    expect(split.proteinPct).toBeCloseTo(100 / 3, 6);
    expect(split.carbsPct).toBeCloseTo(100 / 3, 6);
    expect(split.fatPct).toBeCloseTo(100 / 3, 6);
    expect(split.proteinPct + split.carbsPct + split.fatPct).toBeCloseTo(100, 6);
  });

  it("counts fat at 9 kcal/g, not 4", () => {
    const split = macroEnergySplit({
      energy_kcal: 0,
      protein_g: 0,
      carbs_g: 10,
      fat_g: 10,
      fiber_g: 0,
    });
    expect(split.fatPct).toBeCloseTo((90 / 130) * 100, 6);
    expect(split.carbsPct).toBeCloseTo((40 / 130) * 100, 6);
  });

  it("returns zeros rather than NaN when there is no energy to split", () => {
    expect(macroEnergySplit(EMPTY_MACROS)).toEqual({
      proteinPct: 0,
      carbsPct: 0,
      fatPct: 0,
    });
  });
});
