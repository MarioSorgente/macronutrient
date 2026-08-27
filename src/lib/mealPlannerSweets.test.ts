import { describe, expect, it } from "vitest";
import { generatePlan } from "@/lib/mealPlanner";
import { savedDishCandidate } from "@/lib/plannerCandidates";
import { menuRecipes } from "@/lib/database";
import { classifyCourse } from "@/lib/mealTime";
import { DEFAULT_PREFERENCES } from "@/lib/storage/types";
import type { Dish } from "@/lib/storage/types";

/**
 * Sweets are breakfast food.
 *
 * The reported bug: Protein Banana Bread was planned as Lunch. The menu dish
 * was never the problem — it is curated breakfast-only. A *saved* copy lost that
 * classification and was re-derived from a regex that did not contain the words
 * "banana bread", so it came back as a main: offered for lunch, and barred from
 * the one slot it belongs in.
 */

const WEEK = [0, 1, 2, 3, 4, 5, 6];
const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const TARGET = { energy_kcal: 2200, protein_g: 160, carbs_g: 220, fat_g: 70 };

function savedDish(name: string, items: Dish["items"]): Dish {
  return {
    id: `saved_${name.replace(/\W+/g, "_").toLowerCase()}`,
    createdAt: "", updatedAt: "", name, items,
    totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
  };
}

const item = (ingredientId: string, grams: number) => ({
  ingredientId, name: ingredientId, grams, unitId: "g", quantity: grams,
});

/** A saved copy of the menu dish, ingredient for ingredient. */
function savedCopyOfMenuDish(recipeId: string): Dish {
  const recipe = menuRecipes.find((entry) => entry.recipe_id === recipeId)!;
  return savedDish(
    recipe.name,
    recipe.components
      .filter((component) => component.quantity_g != null)
      .map((component) => item(component.ingredient_id, component.quantity_g!))
  );
}

const plan = (savedDishes: Dish[], overrides: Record<string, unknown> = {}) =>
  generatePlan({
    days: WEEK, slots: SLOTS, targets: TARGET, savedDishes,
    includeSavedDishes: true, includeMenuDishes: true, includeComposed: true,
    dailyBudgetIdr: null, preferences: DEFAULT_PREFERENCES, seed: 7, ...overrides,
  } as Parameters<typeof generatePlan>[0]);

const mealsIn = (days: ReturnType<typeof generatePlan>, slot: string) =>
  days.flatMap((day) => day.meals.filter((meal) => meal.slot === slot));

describe("a saved Negrita sweet", () => {
  const bread = savedCopyOfMenuDish("protein_banana_bread");

  it("keeps the curated classification of the dish it is a copy of", () => {
    const candidate = savedDishCandidate(bread)!;
    expect(candidate.eligibleMealTypes).toEqual(["breakfast"]);
    expect(candidate.mealArchetype).toBe("breakfast");
  });

  it("reports calculated macros, not the published ones", () => {
    // Only the culinary facts are inherited. A saved copy is counted from its
    // own items, which may legitimately differ from the menu's published card.
    expect(savedDishCandidate(bread)!.macroConfidence).toBe("calculated");
  });

  it("is still classified sweet when it is renamed and re-portioned", () => {
    // The menu match needs the name and every gram; this one deliberately fails
    // it, so the fallback vocabulary has to carry the dish on its own.
    const homemade = savedDish("Mum's loaf", [item("banana_bread_negrita", 95)]);
    expect(classifyCourse({ name: homemade.name, ingredients: homemade.items }))
      .toBe("sweet");
    expect(savedDishCandidate(homemade)!.eligibleMealTypes).toEqual(["breakfast"]);
  });

  it("never appears at Lunch or Dinner over a whole week", () => {
    const days = plan([bread]);
    for (const slot of ["Lunch", "Dinner"]) {
      const names = mealsIn(days, slot).map((meal) => meal.name);
      expect(names.filter((name) => /banana bread/i.test(name)), slot).toEqual([]);
    }
  });
});

describe("no sweet reaches a savoury slot", () => {
  const SWEET_IDS = [
    "protein_banana_bread", "special_protein_pancake",
    "protein_bountiful_fruit_waffle", "cheese_cake",
    "oatmeal_banana_peanut_butter", "oatmeal_baked_apple_cinnamon",
  ];
  const sweetNames = SWEET_IDS.map(
    (id) => menuRecipes.find((entry) => entry.recipe_id === id)!.name
  );

  it("keeps every Negrita sweet out of Lunch, Dinner and Snack", () => {
    // Saved copies of all six go into the catalogue alongside the menu, so both
    // the curated path and the saved path are exercised at once.
    const days = plan(SWEET_IDS.map(savedCopyOfMenuDish));
    for (const slot of ["Lunch", "Dinner", "Snack"]) {
      for (const meal of mealsIn(days, slot)) {
        expect(sweetNames, `${meal.name} was served for ${slot}`)
          .not.toContain(meal.name);
      }
    }
  });

  it("still fills every Lunch and Dinner", () => {
    // The point of the ban is a better plan, not a thinner one.
    const days = plan(SWEET_IDS.map(savedCopyOfMenuDish));
    for (const day of days) {
      expect(day.meals.some((meal) => meal.slot === "Lunch")).toBe(true);
      expect(day.meals.some((meal) => meal.slot === "Dinner")).toBe(true);
    }
  });

  it("still lets sweets be breakfast", () => {
    const days = plan(SWEET_IDS.map(savedCopyOfMenuDish));
    const breakfasts = mealsIn(days, "Breakfast").map((meal) => meal.name);
    expect(breakfasts.length).toBeGreaterThan(0);
    // Breakfast is where the sweets live; the tightening must not empty it.
    expect(new Set(breakfasts).size).toBeGreaterThan(1);
  });
});

describe("slots the user renamed", () => {
  it("reads position, so sweets stay in the morning slot", () => {
    // "Meal 1" used to mean dinner, which both admitted every dinner main and
    // barred every sweet from the slot it belongs in.
    const days = plan([savedCopyOfMenuDish("protein_banana_bread")], {
      slots: ["Meal 1", "Meal 2", "Meal 3"], days: [0, 1, 2],
    });
    for (const day of days) {
      for (const meal of day.meals) {
        if (/banana bread|pancake|waffle|cheese ?cake/i.test(meal.name)) {
          expect(meal.slot, `${meal.name} was served for ${meal.slot}`)
            .toBe("Meal 1");
        }
      }
      expect(day.meals.some((meal) => meal.slot === "Meal 3")).toBe(true);
    }
  });
});

describe("composing a savoury main when the ready catalogue cannot", () => {
  it("builds Lunch and Dinner from the DIY menu rather than leaving them empty", () => {
    // Menu dishes off and every saved dish a dessert: the only way to fill a
    // main slot is to compose one.
    const days = plan(
      ["protein_banana_bread", "special_protein_pancake", "cheese_cake"]
        .map(savedCopyOfMenuDish),
      { includeMenuDishes: false, days: [0] }
    );
    const day = days[0];
    expect(day.unfilledSlots).not.toContain("Lunch");
    expect(day.unfilledSlots).not.toContain("Dinner");
    for (const slot of ["Lunch", "Dinner"]) {
      const meal = day.meals.find((entry) => entry.slot === slot);
      expect(meal, `${slot} was not filled`).toBeTruthy();
      expect(meal!.name).not.toMatch(/banana bread|pancake|cheese ?cake/i);
    }
  });
});

describe("across many shuffled weeks", () => {
  const SWEET = /banana bread|pancake|waffle|cheese ?cake|oatmeal/i;

  it.each([1, 2, 3, 5, 8, 13])("keeps seed %i free of sweets at lunch and dinner", (seed) => {
    // Seeds reshuffle between equivalent weeks, so a rule that only holds for
    // one arrangement is not a rule.
    const days = plan([], { seed, days: [0, 1, 2, 3, 4, 5, 6] });
    for (const day of days) {
      for (const meal of day.meals) {
        if (meal.slot === "Lunch" || meal.slot === "Dinner") {
          expect(SWEET.test(meal.name), `${meal.name} at ${meal.slot}`).toBe(false);
        }
      }
    }
  });
});

describe("breakfast is not left as a dessert menu", () => {
  const breakfastsAcross = (seeds: number[]) => {
    const names = new Set<string>();
    for (const seed of seeds) {
      for (const day of plan([], { seed })) {
        for (const meal of day.meals) {
          if (meal.slot === "Breakfast") names.add(meal.name);
        }
      }
    }
    return names;
  };

  it("rotates between sweet and savoury mornings", () => {
    const names = [...breakfastsAcross([1, 3, 7])];
    const sweet = names.filter((name) => /pancake|waffle|cheese ?cake|oatmeal|banana bread/i.test(name));
    const savoury = names.filter((name) => /bacon|salmon|eggs|burrito|chicken/i.test(name));
    expect(sweet.length, `sweet: ${names.join(" | ")}`).toBeGreaterThan(0);
    expect(savoury.length, `savoury: ${names.join(" | ")}`).toBeGreaterThan(0);
  });

  it("can reach the breakfast dishes filed under fitness_meals", () => {
    // Before Cardio and the Breakfast Protein Burrito are curated
    // breakfast-only but sit in the fitness_meals section, so reading the
    // section alone charged them the full wrong-time penalty at breakfast —
    // the one slot they are allowed to occupy — and they never got chosen.
    const names = [...breakfastsAcross([1, 2, 3, 4, 5])].join(" | ");
    expect(names).toMatch(/Before Cardio/);
    expect(names).toMatch(/Breakfast Protein Burrito/);
  });
});
