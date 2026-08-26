import { describe, expect, it } from "vitest";
import { menuRecipes, publishedMenuMacros } from "@/lib/database";

/**
 * The printed menu, transcribed from FOOD FINAL X1 (the two-page Fitness Food
 * card) and checked against the database dish by dish.
 *
 * Prices and published macros are what a diner is quoted and what the planner
 * builds a day from, and both live in a JSON file somebody will hand-edit one
 * day. Verifying them once by eye is worth less than verifying them on every
 * run, so the card is written down here: a price that drifts from the menu
 * fails, and so does a dish appearing or disappearing without the card being
 * updated to match.
 *
 * Figures are per serving, as printed: kcal, protein, carbohydrate, fat, fibre.
 */
const PRINTED_MENU: Record<string, {
  priceIdr: number;
  macros: [number, number, number, number, number];
}> = {
  // Page one — breakfast and sweets, then the mains column.
  cheese_cake: { priceIdr: 65_000, macros: [265, 31, 16, 11, 1] },
  protein_banana_bread: { priceIdr: 79_000, macros: [675, 26, 45, 54, 13] },
  special_protein_pancake: { priceIdr: 89_000, macros: [1095, 50, 157, 38, 13] },
  protein_bountiful_fruit_waffle: { priceIdr: 89_000, macros: [1175, 52, 150, 50, 10] },
  oatmeal_banana_peanut_butter: { priceIdr: 99_000, macros: [1095, 63, 116, 54, 19] },
  oatmeal_baked_apple_cinnamon: { priceIdr: 99_000, macros: [1085, 62, 114, 54, 20] },
  bulking_chicken: { priceIdr: 99_000, macros: [755, 90, 12, 47, 7] },
  geisha: { priceIdr: 99_000, macros: [580, 80, 62, 5, 4] },
  breakfast_protein_burrito: { priceIdr: 99_000, macros: [600, 68, 53, 20, 9] },
  chicken_pita: { priceIdr: 139_000, macros: [855, 91, 70, 29, 7] },
  thai_boy_beefy: { priceIdr: 139_000, macros: [800, 60, 59, 40, 2] },
  thai_boy_chicky: { priceIdr: 139_000, macros: [765, 91, 59, 24, 2] },
  buckwheat_bluefin_tuna: { priceIdr: 139_000, macros: [365, 46, 48, 3, 7] },
  buckwheat_chicken_teriyaki: { priceIdr: 139_000, macros: [545, 63, 55, 14, 7] },
  // Page two — the kebab skewer combo, then the mains column.
  greek_god_chicken: { priceIdr: 139_000, macros: [825, 65, 70, 40, 14] },
  greek_god_tenderloin: { priceIdr: 199_000, macros: [845, 48, 70, 50, 14] },
  greek_god_wagyu: { priceIdr: 169_000, macros: [990, 43, 70, 69, 14] },
  greek_god_salmon: { priceIdr: 169_000, macros: [1040, 58, 70, 68, 14] },
  greek_god_scallops: { priceIdr: 199_000, macros: [770, 45, 77, 40, 14] },
  before_cardio: { priceIdr: 69_000, macros: [480, 20, 85, 11, 7] },
  recovery_salmon: { priceIdr: 179_000, macros: [665, 46, 55, 32, 2] },
  bali_boy: { priceIdr: 85_000, macros: [615, 60, 61, 17, 2] },
  beef_ritual_burger: { priceIdr: 299_000, macros: [1105, 70, 44, 79, 3] },
  peri_peri_chicken: { priceIdr: 119_000, macros: [765, 85, 81, 15, 2] },
  unagi_shogun: { priceIdr: 350_000, macros: [760, 44, 71, 37, 2] },
};

describe("the database against the printed menu", () => {
  it("lists exactly the dishes on the card, and no others", () => {
    expect(menuRecipes.map((recipe) => recipe.recipe_id).sort())
      .toEqual(Object.keys(PRINTED_MENU).sort());
  });

  it.each(Object.entries(PRINTED_MENU))(
    "charges the menu price for %s", (recipeId, printed) => {
      const recipe = menuRecipes.find((entry) => entry.recipe_id === recipeId)!;
      expect(recipe.price_idr).toBe(printed.priceIdr);
    });

  it.each(Object.entries(PRINTED_MENU))(
    "publishes the menu's macros for %s", (recipeId, printed) => {
      const recipe = menuRecipes.find((entry) => entry.recipe_id === recipeId)!;
      const [energy_kcal, protein_g, carbs_g, fat_g, fiber_g] = printed.macros;

      expect(publishedMenuMacros(recipe))
        .toEqual({ energy_kcal, protein_g, carbs_g, fat_g, fiber_g });
    });

  it("prices every dish, since an unpriced one cannot be sold", () => {
    for (const recipe of menuRecipes) {
      expect(typeof recipe.price_idr, recipe.name).toBe("number");
      expect(recipe.price_idr!, recipe.name).toBeGreaterThan(0);
    }
  });
});
