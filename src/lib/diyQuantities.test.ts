import { describe, expect, it } from "vitest";
import { perItemMacros } from "@/lib/calc";
import { diyMenu, getIngredient } from "@/lib/database";
import { diagnoseDailyAdherence } from "@/lib/dailyAdherence";
import { optimalDiyQuantity, quantitiesNearResidual, snapDiyQuantity,
  snappedDiyMacros } from "@/lib/diyQuantities";
import type { Ingredient } from "@/types/nutrition";

function ingredient(id: string): Ingredient {
  const value = getIngredient(id);
  if (!value) throw new Error(`missing fixture ${id}`);
  return value;
}

const asTarget = (macros: ReturnType<typeof perItemMacros>) => ({
  energy_kcal: macros.energy_kcal, protein_g: macros.protein_g,
  carbs_g: macros.carbs_g, fat_g: macros.fat_g,
});

describe("DIY kitchen quantities", () => {
  it("defines operational quantity metadata for every DIY ingredient", () => {
    for (const item of diyMenu) {
      const metadata = ingredient(item.ingredient_id).diy_quantity!;
      expect(metadata).toMatchObject({
        minimum_g: expect.any(Number), maximum_g: expect.any(Number),
        preferred_g: item.portion_g, increment_g: expect.any(Number),
        arbitrary_quantities_supported: expect.any(Boolean),
      });
      expect(metadata.minimum_g).toBeLessThanOrEqual(metadata.preferred_g);
      expect(metadata.preferred_g).toBeLessThanOrEqual(metadata.maximum_g);
    }
  });

  it("snaps chicken to its closest 25 g kitchen increment", () => {
    const metadata = ingredient("chicken_breast_raw").diy_quantity!;
    expect([100, 125, 150, 175, 200].map((grams) => snapDiyQuantity(grams, metadata)))
      .toEqual([100, 125, 150, 175, 200]);
    expect(snapDiyQuantity(163, metadata)).toBe(175);
  });

  it("enforces minimum and maximum quantities", () => {
    const metadata = ingredient("rice_jasmine_cooked_proxy").diy_quantity!;
    expect(snapDiyQuantity(-500, metadata)).toBe(100);
    expect(snapDiyQuantity(999, metadata)).toBe(300);
  });

  it("reuses arbitrary-gram macro calculation after snapping", () => {
    const chicken = ingredient("chicken_breast_raw");
    const result = snappedDiyMacros(chicken, 163);
    expect(result.grams).toBe(175);
    expect(result.macros).toEqual(perItemMacros(chicken, 175));
    expect(result.macros.protein_g).toBeCloseTo(39.375, 6);
  });

  it("closes a residual using the actual supported portion", () => {
    const chicken = ingredient("chicken_breast_raw");
    const target = asTarget(perItemMacros(chicken, 150));
    const grams = optimalDiyQuantity(chicken, target);
    const actual = perItemMacros(chicken, grams);
    expect(grams).toBe(150);
    expect(diagnoseDailyAdherence(actual, target).classification).toBe("Exact");
    expect(quantitiesNearResidual(chicken, target)).toEqual([125, 150, 175]);
  });

  it("reports increment-caused infeasibility from snapped, not theoretical, macros", () => {
    const chicken = ingredient("chicken_breast_raw");
    const theoretical = perItemMacros(chicken, 160);
    const target = asTarget(theoretical);
    const snapped = snappedDiyMacros(chicken, optimalDiyQuantity(chicken, target));
    expect(snapped.grams).toBe(150);
    expect(diagnoseDailyAdherence(snapped.macros, target).classification).toBe("Best effort");
    expect(snapped.macros).not.toEqual(theoretical);
  });
});
