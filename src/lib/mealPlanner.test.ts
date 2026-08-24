import { describe, expect, it } from "vitest";
import { createWeeklyVarietyUsage, generatePlan, generatePlanWithTargets,
  InvalidMacroTargetError, recordWeeklyVariety } from "@/lib/mealPlanner";
import { DEFAULT_PREFERENCES } from "@/lib/storage/types";
import { menuRecipes } from "@/lib/database";
import { generatedDiyCandidate, negritaMenuCandidate, savedDishCandidate } from "@/lib/plannerCandidates";
import { sumDishMacros } from "@/lib/calc";
import { mealSlotEligibility } from "@/lib/slotSuitability";
import { DAILY_MACRO_KEYS, dailyTolerance } from "@/lib/dailyAdherence";
import { COMPLETE_DAY_TARGET, compensatingDayFixtures, extremeCalorieDayFixtures,
  plannerFixture } from "@/lib/mealPlanner.fixtures";
import type { MacroTargets } from "@/lib/storage/types";

const boundedOptions = (targets: MacroTargets, candidateFixtures = compensatingDayFixtures()) => ({
  days: [0], slots: ["Breakfast", "Lunch", "Dinner"], targets, savedDishes: [],
  includeSavedDishes: false, includeMenuDishes: false, includeComposed: false,
  candidateFixtures, dailyBudgetIdr: null, preferences: DEFAULT_PREFERENCES, seed: 1,
}) as Parameters<typeof generatePlan>[0];

it("refuses contradictory calorie and macro targets before searching", () => {
  const targets = { energy_kcal: 4000, protein_g: 175, carbs_g: 175, fat_g: 66.7 };
  expect(() => generatePlanWithTargets({ ...boundedOptions(targets), targets }))
    .toThrowError(InvalidMacroTargetError);
  try {
    generatePlanWithTargets({ ...boundedOptions(targets), targets });
  } catch (error) {
    expect(error).toMatchObject({
      code: "INVALID_TARGET_MACRO_ENERGY_MISMATCH",
      requestedEnergyKcal: 4000,
    });
    expect((error as InvalidMacroTargetError).macroEnergyKcal).toBeCloseTo(2000.3, 5);
  }
});

function expectCompleteDayWithinTolerance(day: ReturnType<typeof generatePlan>[number],
  target: MacroTargets): void {
  expect(day.unfilledSlots).toEqual([]);
  expect(day.adherence.compliant).toBe(true);
  expect(day.adherence.classification).not.toMatch(/Best effort|Impossible/);
  for (const key of DAILY_MACRO_KEYS) {
    expect(Math.abs(day.macros[key] - target[key]), key)
      .toBeLessThanOrEqual(dailyTolerance(key, target[key]));
  }
}

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

describe("complete-day compensation", () => {
  it("accepts low breakfast protein when high lunch protein compensates", () => {
    const day = generatePlan(boundedOptions(COMPLETE_DAY_TARGET))[0];
    const suggestedProtein = COMPLETE_DAY_TARGET.protein_g / 3;

    expect(day.meals.find((meal) => meal.slot === "Breakfast")!.macros.protein_g)
      .toBeLessThan(suggestedProtein);
    expect(day.meals.find((meal) => meal.slot === "Lunch")!.macros.protein_g)
      .toBeGreaterThan(suggestedProtein);
    expectCompleteDayWithinTolerance(day, COMPLETE_DAY_TARGET);
  });

  it("accepts a Geisha-style oversized lunch and compensates later with less protein", () => {
    const day = generatePlan(boundedOptions(COMPLETE_DAY_TARGET))[0];
    const lunch = day.meals.find((meal) => meal.slot === "Lunch")!;
    const dinner = day.meals.find((meal) => meal.slot === "Dinner")!;

    expect(lunch.name).toMatch(/Geisha/);
    expect(lunch.macros.protein_g).toBeGreaterThan(COMPLETE_DAY_TARGET.protein_g / 3);
    expect(dinner.macros.protein_g).toBeLessThan(lunch.macros.protein_g);
    expectCompleteDayWithinTolerance(day, COMPLETE_DAY_TARGET);
  });

  it("keeps a necessary meal outside the former 35–180% slot calorie gate", () => {
    const day = generatePlan(boundedOptions(COMPLETE_DAY_TARGET,
      extremeCalorieDayFixtures()))[0];
    const provisionalSlotCalories = COMPLETE_DAY_TARGET.energy_kcal / 3;
    const breakfast = day.meals.find((meal) => meal.slot === "Breakfast")!;

    expect(breakfast.macros.energy_kcal).toBeLessThan(provisionalSlotCalories * 0.35);
    expectCompleteDayWithinTolerance(day, COMPLETE_DAY_TARGET);
  });

  it("does not reject a classified meal for missing provisional slot macros", () => {
    const candidate = extremeCalorieDayFixtures()[0];
    expect(mealSlotEligibility({ slot: "Breakfast", name: candidate.displayName,
      mealArchetype: candidate.mealArchetype, eligibleMealTypes: candidate.eligibleMealTypes,
      ingredients: candidate.breakdown })).toEqual({ allowed: true,
      reason: "ELIGIBLE_CLASSIFIED_SLOT" });
  });
});

describe("bounded whole-day search matrix", () => {
  it("keeps hundreds of deterministic target/seed combinations feasible and fast", () => {
    const started = performance.now();
    let generated = 0;
    for (let targetIndex = 0; targetIndex < 20; targetIndex += 1) {
      const factor = 0.8 + targetIndex * 0.02;
      const target: MacroTargets = {
        energy_kcal: COMPLETE_DAY_TARGET.energy_kcal * factor,
        protein_g: COMPLETE_DAY_TARGET.protein_g * factor,
        carbs_g: COMPLETE_DAY_TARGET.carbs_g * factor,
        fat_g: COMPLETE_DAY_TARGET.fat_g * factor,
      };
      const fixtures = [
        plannerFixture("Matrix breakfast", "Breakfast", { energy_kcal: 600 * factor,
          protein_g: 30 * factor, carbs_g: 60 * factor, fat_g: 20 * factor }),
        plannerFixture("Matrix lunch", "Lunch", { energy_kcal: 750 * factor,
          protein_g: 70 * factor, carbs_g: 75 * factor, fat_g: 25 * factor }),
        plannerFixture("Matrix dinner", "Dinner", { energy_kcal: 650 * factor,
          protein_g: 50 * factor, carbs_g: 65 * factor, fat_g: 25 * factor }),
      ];
      for (let seed = 1; seed <= 15; seed += 1) {
        const day = generatePlan({ ...boundedOptions(target, fixtures), seed })[0];
        expectCompleteDayWithinTolerance(day, target);
        generated += 1;
      }
    }
    expect(generated).toBe(300);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("never lets a seed turn a feasible bounded result into Best effort", () => {
    const statuses = Array.from({ length: 100 }, (_, seed) => generatePlan({
      ...boundedOptions(COMPLETE_DAY_TARGET), seed,
    })[0].adherence.classification);
    expect(new Set(statuses)).toEqual(new Set(["Exact"]));
  });
});

describe("hard constraints and infeasible diagnostics", () => {
  it("keeps culinary slot rules even when an inappropriate meal has ideal macros", () => {
    const candidates = compensatingDayFixtures();
    const inappropriate = plannerFixture("Peri Peri dinner main", "Dinner",
      { energy_kcal: 600, protein_g: 30, carbs_g: 60, fat_g: 20 });
    // Put the dinner-only perfect candidate into the catalog alongside breakfast.
    const day = generatePlan(boundedOptions(COMPLETE_DAY_TARGET,
      [inappropriate, ...candidates]))[0];
    expect(day.meals.find((meal) => meal.slot === "Breakfast")!.name)
      .toBe("Light protein breakfast");
    expectCompleteDayWithinTolerance(day, COMPLETE_DAY_TARGET);
  });

  it("reports signed failed dimensions for a complete but infeasible macro target", () => {
    const target = { ...COMPLETE_DAY_TARGET, protein_g: 180, carbs_g: 180 };
    const day = generatePlan(boundedOptions(target))[0];
    expect(day.adherence.classification).toBe("Best effort");
    expect(day.adherence.compliant).toBe(false);
    expect(day.adherence.failureDimensions).toEqual(["protein_g", "carbs_g"]);
    expect(day.adherence.macros.protein_g.signedDeviation).toBe(-30);
    expect(day.adherence.macros.carbs_g.signedDeviation).toBe(20);
    expect(day.adherence.reasonCodes).toEqual(expect.arrayContaining([
      "protein_below_tolerance", "carbs_above_tolerance",
    ]));
  });

  it("reports Impossible, rather than success, when a slot has no eligible candidate", () => {
    const day = generatePlan(boundedOptions(COMPLETE_DAY_TARGET,
      compensatingDayFixtures().filter((candidate) =>
        !candidate.eligibleMealTypes.includes("dinner"))))[0];
    expect(day.adherence.classification).toBe("Impossible");
    expect(day.adherence.compliant).toBe(false);
    expect(day.unfilledSlots).toEqual(["Dinner"]);
    expect(day.adherence.reasonCodes).toContain("no_eligible_dinner_candidates");
    for (const key of DAILY_MACRO_KEYS) {
      expect(day.adherence.macros[key].signedDeviation)
        .toBe(day.macros[key] - COMPLETE_DAY_TARGET[key]);
    }
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

describe("normalized weekly variety", () => {
  it("counts menu, saved, and DIY candidates by the same normalized families", () => {
    const geisha = negritaMenuCandidate(menuRecipes.find((recipe) =>
      recipe.recipe_id === "geisha")!)!;
    const anotherChickenDish = menuRecipes.map(negritaMenuCandidate).find((candidate) =>
      candidate?.proteinFamily === "chicken" &&
      candidate.exactDishIdentity !== geisha.exactDishIdentity)!;
    const items = [
      { ingredientId: "chicken_breast_raw", name: "Chicken breast", grams: 150,
        unitId: "g", quantity: 150 },
      { ingredientId: "rice_jasmine_cooked_proxy", name: "Jasmine rice", grams: 150,
        unitId: "g", quantity: 150 },
    ];
    const generatedPlate = generatedDiyCandidate({ id: "test-chicken-plate",
      name: "Generated chicken plate", items, macros: sumDishMacros(items), priceIdr: 50000 });
    const savedPlate = savedDishCandidate({ id: "saved-chicken", name: "Opaque favorite",
      items, totals: sumDishMacros(items), createdAt: "2026-01-01",
      updatedAt: "2026-01-01" })!;
    const usage = createWeeklyVarietyUsage();

    [geisha, anotherChickenDish, savedPlate, generatedPlate].forEach((candidate) =>
      recordWeeklyVariety(usage, candidate));

    expect(usage.proteinFamily.get("chicken")).toBe(4);
    expect([geisha, savedPlate, generatedPlate].map((candidate) => candidate.carbFamily))
      .toEqual(["rice", "rice", "rice"]);
    expect(usage.carbFamily.get("rice")).toBeGreaterThanOrEqual(3);
    expect(usage.proteinFamily.has(geisha.id)).toBe(false);
    expect(usage.exactDishIdentity.size).toBe(4);
  });
});
