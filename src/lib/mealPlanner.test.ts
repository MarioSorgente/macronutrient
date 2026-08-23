import { describe, expect, it } from "vitest";
import { generatePlan } from "@/lib/mealPlanner";
import { DEFAULT_PREFERENCES } from "@/lib/storage/types";
import { menuRecipes } from "@/lib/database";
import { negritaMenuCandidate } from "@/lib/plannerCandidates";
import { mealSlotEligibility } from "@/lib/slotSuitability";

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

  it("keeps large classified breakfast dishes eligible regardless of slot macros", () => {
    const recipe = menuRecipes.find((item) => item.recipe_id ===
      "oatmeal_banana_peanut_butter")!;
    const candidate = negritaMenuCandidate(recipe)!;
    expect(candidate.optimizerMacros.energy_kcal).toBeGreaterThan(1000);
    expect(mealSlotEligibility({ slot: "Breakfast", name: candidate.displayName,
      mealArchetype: candidate.mealArchetype,
      eligibleMealTypes: candidate.eligibleMealTypes,
      ingredients: candidate.breakdown })).toMatchObject({
      allowed: true, reason: "ELIGIBLE_CLASSIFIED_SLOT",
    });
  });
});

describe("seeded complete-day selection", () => {
  const options = {
    days: [0],
    slots: ["Breakfast", "Lunch", "Dinner"],
    targets: { energy_kcal: 2200, protein_g: 160, carbs_g: 220, fat_g: 70 },
    savedDishes: [],
    includeSavedDishes: false,
    includeMenuDishes: true,
    includeComposed: true,
    dailyBudgetIdr: null,
    preferences: DEFAULT_PREFERENCES,
  } as Parameters<typeof generatePlan>[0];

  it("is deterministic for identical inputs and seed", () => {
    expect(generatePlan({ ...options, seed: 8675309 })).toEqual(
      generatePlan({ ...options, seed: 8675309 })
    );
  });

  it("does not let the seed demote a feasible day to Best effort", () => {
    // Target a day the real menu can produce, then vary only the tie-breaker.
    const attainable = generatePlan({ ...options, seed: 1 })[0].macros;
    const classifications = [1, 2, 3, 99].map((seed) =>
      generatePlan({ ...options, targets: attainable, seed })[0].adherence.classification
    );

    expect(classifications).not.toContain("Best effort");
    expect(new Set(classifications).size).toBe(1);
  });
});

describe("curated menu eligibility", () => {
  it.each(["Lunch", "Dinner"])("optimizes Geisha normally for %s", (slot) => {
    const recipe = menuRecipes.find((item) => item.recipe_id === "geisha")!;
    const geisha = negritaMenuCandidate(recipe)!;
    const targets = { energy_kcal: geisha.optimizerMacros.energy_kcal,
      protein_g: geisha.optimizerMacros.protein_g, carbs_g: geisha.optimizerMacros.carbs_g,
      fat_g: geisha.optimizerMacros.fat_g };
    const day = generatePlan({
      days: [0], slots: [slot], targets, savedDishes: [], includeSavedDishes: false,
      includeMenuDishes: true, includeComposed: false, dailyBudgetIdr: null,
      preferences: DEFAULT_PREFERENCES, seed: 1,
    } as Parameters<typeof generatePlan>[0])[0];

    expect(day.meals).toHaveLength(1);
    expect(day.meals[0]).toMatchObject({ slot, name: recipe.name, kind: "ready" });
    expect(day.meals[0].macros).toEqual(geisha.optimizerMacros);
  });
});
