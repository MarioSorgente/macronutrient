import { describe, expect, it } from "vitest";
import { generatePlan } from "@/lib/mealPlanner";
import { DEFAULT_PREFERENCES } from "@/lib/storage/types";

/**
 * A regression test over the real generator and the real menu, not the scoring
 * in isolation — the slot penalty passed its own unit tests while the planner
 * still served peri peri chicken at breakfast, because the variety penalty was
 * pushing it back toward dinner proteins.
 */
describe("generated breakfasts", () => {
  it("stops putting dinner mains at breakfast", () => {
    const days = generatePlan({
      days: [0, 1, 2, 3, 4, 5, 6],
      slots: ["Breakfast", "Lunch", "Dinner"],
      targets: { energy_kcal: 2200, protein_g: 160, carbs_g: 220, fat_g: 70 },
      savedDishes: [],
      includeSavedDishes: false,
      includeMenuDishes: true,
      includeComposed: true,
      dailyBudgetIdr: null,
      preferences: DEFAULT_PREFERENCES,
      seed: 42,
    } as Parameters<typeof generatePlan>[0]);

    const breakfasts = days.flatMap((d) =>
      d.meals.filter((m) => m.slot === "Breakfast")
    );
    const heavy = /peri.?peri|teriyaki|mushroom sauce|steak|wagyu|kofta/i;
    const offenders = breakfasts.filter((m) => heavy.test(m.name));

    expect(breakfasts.length).toBeGreaterThan(0);
    expect(
      offenders.map((m) => m.name),
      "no saucy dinner mains at breakfast"
    ).toEqual([]);
  });

  it("can reach the breakfast menu section once a day is big enough", () => {
    // Pancakes, waffles and oatmeal bowls are 1,100-1,250 kcal dishes. They
    // were invisible before the quantity fit — an Oatmeal Bowl computed as
    // 108 kcal of whey — and should now be picked when the target suits them.
    const days = generatePlan({
      days: [0, 1, 2, 3, 4, 5, 6],
      slots: ["Breakfast", "Lunch", "Dinner"],
      targets: { energy_kcal: 3300, protein_g: 200, carbs_g: 380, fat_g: 110 },
      savedDishes: [],
      includeSavedDishes: false,
      includeMenuDishes: true,
      includeComposed: true,
      dailyBudgetIdr: null,
      preferences: DEFAULT_PREFERENCES,
      seed: 1,
    } as Parameters<typeof generatePlan>[0]);

    const breakfastNames = days
      .flatMap((d) => d.meals.filter((m) => m.slot === "Breakfast"))
      .map((m) => m.name);

    expect(
      breakfastNames.some((n) => /oatmeal|pancake|waffle|banana bread/i.test(n)),
      `expected a breakfast-menu dish, got: ${breakfastNames.join(", ")}`
    ).toBe(true);
  });
});
