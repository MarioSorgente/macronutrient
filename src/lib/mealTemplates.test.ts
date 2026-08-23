import { describe, expect, it } from "vitest";
import { diyMenu, getIngredient } from "@/lib/database";
import {
  MEAL_TEMPLATES,
  componentFitsTemplate,
  ingredientFamily,
  roleForSection,
  templatesForSlot,
} from "@/lib/mealTemplates";

describe("meal templates", () => {
  it("declares the ten initial archetypes with complete culinary constraints", () => {
    expect(MEAL_TEMPLATES.map((item) => item.id)).toEqual([
      "breakfast-bowl", "eggs-and-toast", "protein-breakfast", "rice-bowl",
      "mediterranean-plate", "salad", "wrap", "main-plus-side", "snack",
      "pre-workout-meal",
    ]);
    for (const item of MEAL_TEMPLATES) {
      expect(item.allowedSlots.length).toBeGreaterThan(0);
      expect(item.requiredRoles.length).toBeGreaterThan(0);
      expect(item.mealSize.minKcal).toBeLessThan(item.mealSize.maxKcal);
      for (const role of [...item.requiredRoles, ...item.optionalRoles]) {
        expect(item.compatibleFamilies[role].length).toBeGreaterThan(0);
        expect(item.quantities[role].minG).toBeLessThan(item.quantities[role].maxG);
      }
    }
  });

  it("uses explicit metadata for ambiguous foods and rejects implausible pairs", () => {
    const bacon = getIngredient("bacon_streaky")!;
    const rice = getIngredient("rice_jasmine_cooked_proxy")!;
    const eggsAndToast = MEAL_TEMPLATES.find((item) => item.id === "eggs-and-toast")!;
    expect(ingredientFamily(bacon, "protein")).toBe("breakfast-meat");
    expect(componentFitsTemplate(eggsAndToast, rice, "carbs", 200)).toBe(false);
  });

  it("keeps the actual DIY menu portions inside archetype quantity bounds", () => {
    for (const mealTemplate of MEAL_TEMPLATES) {
      for (const role of mealTemplate.requiredRoles) {
        const possible = diyMenu.some((item) => {
          const ingredient = getIngredient(item.ingredient_id);
          return ingredient && roleForSection(item.section) === role &&
            componentFitsTemplate(mealTemplate, ingredient, item.section, item.portion_g);
        });
        // Sauce is represented by the fats/condiments menu section and is not
        // currently required by any archetype.
        expect(possible, `${mealTemplate.id} can fill ${role}`).toBe(true);
      }
    }
    expect(templatesForSlot("Meal").map((item) => item.id)).toEqual(["main-plus-side"]);
  });
});
