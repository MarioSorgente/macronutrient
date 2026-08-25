import { describe, expect, it, vi } from "vitest";
import { estimateCompletion, generatePlan, kitchenIncrementsPreventCompliance,
  type MacroRange } from "@/lib/mealPlanner";
import { diagnoseDailyAdherence } from "@/lib/dailyAdherence";
import { COMPLETE_DAY_TARGET, plannerFixture } from "@/lib/mealPlanner.fixtures";
import { DEFAULT_PREFERENCES, type MacroTargets } from "@/lib/storage/types";
import type { PlannerCandidate } from "@/types/nutrition";

/**
 * The planner's priority order, asserted one rule at a time on bounded
 * catalogs: hard eligibility, then adherence, then feasibility of the complete
 * day, then variety, then preferences, then price, then the seed.
 */

const fixtureDay = (targets: MacroTargets, candidateFixtures: PlannerCandidate[],
  overrides: Record<string, unknown> = {}) => generatePlan({
  days: [0], slots: ["Breakfast", "Lunch", "Dinner"], targets, savedDishes: [],
  includeSavedDishes: false, includeMenuDishes: false, includeComposed: false,
  candidateFixtures, dailyBudgetIdr: null, preferences: DEFAULT_PREFERENCES,
  seed: 1, ...overrides,
} as Parameters<typeof generatePlan>[0])[0];

describe("feasibility-aware pruning", () => {
  it("rates a residual the remaining slots can still cover as recoverable", () => {
    const reachable: MacroRange = {
      min: { energy_kcal: 900, protein_g: 60, carbs_g: 90, fat_g: 30 },
      max: { energy_kcal: 1500, protein_g: 120, carbs_g: 160, fat_g: 70 },
    };
    const recoverable = estimateCompletion(
      { energy_kcal: 1300, protein_g: 100, carbs_g: 130, fat_g: 50 },
      reachable, COMPLETE_DAY_TARGET);
    const overshot = estimateCompletion(
      { energy_kcal: 500, protein_g: 30, carbs_g: 40, fat_g: 10 },
      reachable, COMPLETE_DAY_TARGET);

    expect(recoverable.infeasibility).toBe(0);
    expect(overshot.infeasibility).toBeGreaterThan(0);
    // A state that can still finish inside tolerance must never lose to one
    // that mathematically cannot, whatever their current distances look like.
    expect(recoverable.infeasibility).toBeLessThan(overshot.infeasibility);
  });

  it("collapses to the day's own error once no slots remain", () => {
    const nothingLeft: MacroRange = {
      min: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
      max: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
    };
    const closed = estimateCompletion({ energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
      nothingLeft, COMPLETE_DAY_TARGET);
    const short = estimateCompletion({ energy_kcal: 120, protein_g: 10, carbs_g: 12, fat_g: 8 },
      nothingLeft, COMPLETE_DAY_TARGET);

    expect(closed).toEqual({ infeasibility: 0, slack: 0 });
    expect(short.infeasibility).toBeGreaterThan(0);
    expect(short.slack).toBe(short.infeasibility);
  });

  it("keeps the only breakfast that can still produce an Exact day", () => {
    // 400 decoys, each larger and higher in protein than the one right answer —
    // exactly what a partial score measured against the *whole* day's target
    // prefers, and exactly what used to evict the correct path before lunch.
    const decoys = Array.from({ length: 400 }, (_, index) =>
      plannerFixture(`Tempting breakfast ${index}`, "Breakfast",
        { energy_kcal: 900, protein_g: 60, carbs_g: 80, fat_g: 40 }));
    const day = fixtureDay(COMPLETE_DAY_TARGET, [
      ...decoys,
      plannerFixture("Modest breakfast", "Breakfast",
        { energy_kcal: 700, protein_g: 50, carbs_g: 70, fat_g: 20 }),
      plannerFixture("Only lunch", "Lunch",
        { energy_kcal: 700, protein_g: 55, carbs_g: 70, fat_g: 25 }),
      plannerFixture("Only dinner", "Dinner",
        { energy_kcal: 600, protein_g: 45, carbs_g: 60, fat_g: 25 }),
    ]);

    expect(day.meals[0].name).toBe("Modest breakfast");
    expect(day.adherence.classification).toBe("Exact");
  });
});

describe("price never buys a worse day", () => {
  const catalog = () => [
    plannerFixture("Expensive exact breakfast", "Breakfast",
      { energy_kcal: 700, protein_g: 50, carbs_g: 70, fat_g: 20 }, { priceIdr: 300_000 }),
    plannerFixture("Bargain breakfast", "Breakfast",
      { energy_kcal: 600, protein_g: 40, carbs_g: 60, fat_g: 16 }, { priceIdr: 20_000 }),
    plannerFixture("Only lunch", "Lunch",
      { energy_kcal: 700, protein_g: 55, carbs_g: 70, fat_g: 25 }, { priceIdr: 25_000 }),
    plannerFixture("Only dinner", "Dinner",
      { energy_kcal: 600, protein_g: 45, carbs_g: 60, fat_g: 25 }, { priceIdr: 25_000 }),
  ];

  it("takes the expensive Exact day when no budget is set", () => {
    const day = fixtureDay(COMPLETE_DAY_TARGET, catalog());
    expect(day.meals[0].name).toBe("Expensive exact breakfast");
    expect(day.adherence.classification).toBe("Exact");
  });

  it("takes the cheaper Best effort day only when a budget forbids the other", () => {
    const day = fixtureDay(COMPLETE_DAY_TARGET, catalog(), { dailyBudgetIdr: 200_000 });
    expect(day.meals[0].name).toBe("Bargain breakfast");
    expect(day.price.totalIdr).toBeLessThanOrEqual(200_000);
    expect(day.adherence.classification).toBe("Best effort");
  });
});

describe("repetition inside a single day", () => {
  const breakfast = () => plannerFixture("The breakfast", "Breakfast",
    { energy_kcal: 600, protein_g: 50, carbs_g: 60, fat_g: 20 });
  const main = (name: string) => plannerFixture(name, "Lunch",
    { energy_kcal: 700, protein_g: 50, carbs_g: 70, fat_g: 25 },
    { alsoEligibleFor: ["dinner"] });

  it("does not serve the same dish for lunch and dinner when an equal one exists", () => {
    const day = fixtureDay(COMPLETE_DAY_TARGET,
      [breakfast(), main("First main"), main("Second main")]);

    expect(day.meals.map((meal) => meal.name)).toHaveLength(3);
    expect(new Set(day.meals.map((meal) => meal.name)).size).toBe(3);
    expect(day.adherence.classification).toBe("Exact");
  });

  it("repeats the same dish when nothing else can complete the day", () => {
    const day = fixtureDay(COMPLETE_DAY_TARGET, [breakfast(), main("The only main")]);

    expect(day.meals[1].name).toBe("The only main");
    expect(day.meals[2].name).toBe("The only main");
    expect(day.adherence.classification).toBe("Exact");
  });

  it("prefers hitting the target over avoiding a repeat", () => {
    // A second, different main is available — and taking it misses the target.
    const day = fixtureDay(COMPLETE_DAY_TARGET, [
      breakfast(), main("Necessary main"),
      plannerFixture("A more varied but wrong main", "Lunch",
        { energy_kcal: 420, protein_g: 20, carbs_g: 45, fat_g: 10 },
        { alsoEligibleFor: ["dinner"] }),
    ]);

    expect(day.meals[1].name).toBe("Necessary main");
    expect(day.meals[2].name).toBe("Necessary main");
    expect(day.adherence.classification).toBe("Exact");
  });
});

describe("truthful diagnostics", () => {
  it("does not blame kitchen portions for a day built entirely from whole dishes", () => {
    const day = fixtureDay({ ...COMPLETE_DAY_TARGET, protein_g: 180, carbs_g: 180 }, [
      plannerFixture("Fixed breakfast", "Breakfast",
        { energy_kcal: 600, protein_g: 30, carbs_g: 60, fat_g: 20 }),
      plannerFixture("Fixed lunch", "Lunch",
        { energy_kcal: 750, protein_g: 70, carbs_g: 75, fat_g: 25 }),
      plannerFixture("Fixed dinner", "Dinner",
        { energy_kcal: 650, protein_g: 50, carbs_g: 65, fat_g: 25 }),
    ]);

    expect(day.adherence.classification).toBe("Best effort");
    expect(day.adherence.reasonCodes).toContain("closest_available_combination_outside_tolerance");
    expect(day.adherence.reasonCodes)
      .not.toContain("kitchen_portion_increments_prevent_compliance");
  });

  it("blames kitchen portions only when one serving step is wider than the tolerance", () => {
    const target = { energy_kcal: 2000, protein_g: 150, carbs_g: 186, fat_g: 70 };
    const missed = { energy_kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 70, fiber_g: 0 };
    const diagnostics = diagnoseDailyAdherence(missed, target);
    expect(diagnostics.failureDimensions).toEqual(["carbs_g"]);

    // Jasmine rice moves in 50 g steps, which is 14 g of carbohydrate — wider
    // than the 12 g the whole tolerance window is worth.
    const coarse = [{ kind: "composed" as const, items: [{ ingredientId: "rice_jasmine_cooked_proxy",
      name: "Jasmine rice", grams: 200, unitId: "g", quantity: 200 }] }];
    // Cherry tomatoes move in 10 g steps, so an adjustment inside the window
    // exists and the increments are not what stopped it.
    const fine = [...coarse, { kind: "composed" as const, items: [{ ingredientId: "tomato_cherry_raw",
      name: "Cherry tomatoes", grams: 80, unitId: "g", quantity: 80 }] }];

    expect(kitchenIncrementsPreventCompliance(coarse, diagnostics, target)).toBe(true);
    expect(kitchenIncrementsPreventCompliance(fine, diagnostics, target)).toBe(false);
    expect(kitchenIncrementsPreventCompliance([], diagnostics, target)).toBe(false);
  });
});

describe("candidate order independence", () => {
  const options = {
    days: [0, 1, 2, 3, 4, 5, 6], slots: ["Breakfast", "Lunch", "Dinner", "Snack"],
    targets: { energy_kcal: 2000, protein_g: 175, carbs_g: 175, fat_g: 66.7 },
    savedDishes: [], includeSavedDishes: false, includeMenuDishes: true,
    includeComposed: true, dailyBudgetIdr: null, preferences: DEFAULT_PREFERENCES,
    seed: 1,
  };

  async function weekWithCatalogOrder(reversed: boolean) {
    vi.resetModules();
    if (reversed) {
      vi.doMock("@/lib/database", async () => {
        const actual = await vi.importActual<typeof import("@/lib/database")>("@/lib/database");
        return { ...actual, diyMenu: [...actual.diyMenu].reverse(),
          menuRecipes: [...actual.menuRecipes].reverse() };
      });
    } else {
      vi.doUnmock("@/lib/database");
    }
    const planner = await import("@/lib/mealPlanner");
    const days = planner.generatePlan(options as Parameters<typeof generatePlan>[0]);
    return {
      classes: new Set(days.map((day) => day.adherence.classification)),
      worstError: Math.max(...days.map((day) => day.adherence.normalizedError)),
      distinctDishes: new Set(days.flatMap((day) =>
        day.meals.map((meal) => meal.name))).size,
      distinctDays: new Set(days.map((day) =>
        day.meals.map((meal) => meal.name).join("|"))).size,
    };
  }

  it("does not let the order of the DIY catalog decide the week", async () => {
    const forward = await weekWithCatalogOrder(false);
    const reversed = await weekWithCatalogOrder(true);
    vi.doUnmock("@/lib/database");
    vi.resetModules();

    expect(reversed.classes).toEqual(forward.classes);
    expect(reversed.distinctDays).toBe(forward.distinctDays);
    expect(Math.abs(reversed.worstError - forward.worstError)).toBeLessThan(0.5);
    expect(reversed.distinctDishes)
      .toBeGreaterThanOrEqual(Math.floor(forward.distinctDishes * 0.7));
    // Two full weeks against the real catalog, each with the module graph reset
    // in between. Sized to survive running beside the rest of a CPU-bound suite
    // rather than to police the search's speed, which `npm run bench` does.
  }, 120_000);
});
