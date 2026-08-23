import { describe, expect, it } from "vitest";
import { sumDishMacros } from "@/lib/calc";
import { menuRecipes } from "@/lib/database";
import { generatedDiyCandidate, negritaMenuCandidate, readyPlannerCatalog, savedDishCandidate } from "@/lib/plannerCandidates";
import { diagnoseDailyAdherence } from "@/lib/dailyAdherence";
import type { Dish, DishItem } from "@/lib/storage/types";

const chickenAndRice: DishItem[] = [
  { ingredientId: "chicken_breast_raw", name: "Chicken breast", grams: 150,
    unitId: "g", quantity: 150 },
  { ingredientId: "rice_jasmine_cooked_proxy", name: "Jasmine rice", grams: 150,
    unitId: "g", quantity: 150 },
];

describe("normalized planner candidates", () => {
  it("gives ready-made and generated chicken-and-rice the same families", () => {
    // Deliberately give the saved dish an opaque name: its ingredient
    // composition, not name matching, must drive normalization.
    const saved: Dish = { id: "lunch-1", name: "My usual", items: chickenAndRice,
      totals: sumDishMacros(chickenAndRice), createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    const ready = savedDishCandidate(saved);
    const generated = generatedDiyCandidate({ id: "chicken-rice", name: "Built lunch",
      items: chickenAndRice, macros: sumDishMacros(chickenAndRice), priceIdr: 50000 });

    expect(ready).not.toBeNull();
    expect(ready?.proteinFamily).toBe("chicken");
    expect(ready?.carbFamily).toBe("rice");
    expect(generated.proteinFamily).toBe(ready?.proteinFamily);
    expect(generated.carbFamily).toBe(ready?.carbFamily);
  });

  it("normalizes every enabled Negrita recipe into the shared catalog", () => {
    const catalog = readyPlannerCatalog([], true);
    expect(catalog).toHaveLength(menuRecipes.length);
    expect(catalog.every((candidate) => candidate.source === "negrita_menu")).toBe(true);
    expect(catalog.every((candidate) => candidate.id && candidate.breakdown.length)).toBe(true);
    expect(catalog.every((candidate) => candidate.macroConfidence === "published")).toBe(true);
  });

  it.each([
    ["geisha", false],
    ["protein_banana_bread", true],
    ["before_cardio", true],
    ["unagi_shogun", true],
    ["special_protein_pancake", true],
  ])("keeps published and fitted totals separate for %s", (recipeId, materialMismatch) => {
    const recipe = menuRecipes.find((item) => item.recipe_id === recipeId)!;
    const candidate = negritaMenuCandidate(recipe)!;

    expect(candidate.optimizerMacros).toEqual({
      energy_kcal: recipe.menu_macros_per_serving.energy_kcal,
      protein_g: recipe.menu_macros_per_serving.protein_g,
      carbs_g: recipe.menu_macros_per_serving.carbs_g,
      fat_g: recipe.menu_macros_per_serving.fat_g,
      fiber_g: recipe.menu_macros_per_serving.fiber_g,
    });
    expect(candidate.calculatedIngredientMacros).toBeDefined();
    const largestDifference = Math.max(...(["energy_kcal", "protein_g", "carbs_g", "fat_g"] as const)
      .map((key) => Math.abs(candidate.optimizerMacros[key] -
        candidate.calculatedIngredientMacros![key]) / candidate.optimizerMacros[key]));
    const fitMismatch = recipe.derived_quantities?.worstPct ?? largestDifference * 100;
    expect(fitMismatch > 10).toBe(materialMismatch);
  });

  it("uses the published total for strict daily adherence despite reconstruction mismatch", () => {
    const recipe = menuRecipes.find((item) => item.recipe_id === "unagi_shogun")!;
    const candidate = negritaMenuCandidate(recipe)!;
    const target = candidate.optimizerMacros;

    expect(diagnoseDailyAdherence(candidate.optimizerMacros, target).classification).toBe("Exact");
    expect(diagnoseDailyAdherence(candidate.calculatedIngredientMacros!, target).classification)
      .toBe("Best effort");
  });
});
