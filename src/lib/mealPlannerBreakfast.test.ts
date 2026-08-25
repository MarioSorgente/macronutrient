import { describe, expect, it } from "vitest";
import {
  __dayPoolForTests,
  generateDayWithLockedMeal,
  generatePlan,
  type GeneratedDay,
} from "@/lib/mealPlanner";
import { menuRecipes } from "@/lib/database";
import { negritaMenuCandidate } from "@/lib/plannerCandidates";
import { COMPLETE_DAY_TARGET, plannerFixture } from "@/lib/mealPlanner.fixtures";
import { DEFAULT_PREFERENCES, type MacroTargets } from "@/lib/storage/types";
import type { PlannerCandidate } from "@/types/nutrition";

/**
 * The target belongs to the whole day.
 *
 * Two rules follow from that, and this file is the regression cover for both.
 * A breakfast may be any size, because what matters is the day it leaves behind
 * — so the menu's 1,085-1,175 kcal pancakes, waffles and oatmeal bowls are
 * judged by locking them in and solving the rest of the day, never by how they
 * compare to a slot-sized share of the target. And a snack is optional, because
 * a day that reaches its macros in three meals is finished.
 *
 * The previous version of this test concluded a pancake was impossible from the
 * fact that the planner had not picked one. That is a different question, and
 * answering it as though it were this one is what kept them off the menu.
 */

const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const WEEK = [0, 1, 2, 3, 4, 5, 6];
const SWEET = /pancake|waffle|oatmeal|banana bread/i;

/** The five large breakfasts the restaurant actually sells. */
const LARGE_BREAKFASTS = [
  "special_protein_pancake",
  "protein_bountiful_fruit_waffle",
  "oatmeal_banana_peanut_butter",
  "oatmeal_baked_apple_cinnamon",
  "protein_banana_bread",
];

const BALANCED: MacroTargets = {
  energy_kcal: 2000, protein_g: 125, carbs_g: 225, fat_g: 66.7,
};
/** Small enough that a 1,175 kcal breakfast leaves no room for four meals. */
const LIGHT: MacroTargets = {
  energy_kcal: 1800, protein_g: 112.5, carbs_g: 202.5, fat_g: 60,
};
const CARB_HEAVY: MacroTargets = {
  energy_kcal: 2600, protein_g: 130, carbs_g: 330, fat_g: 80,
};
/** 175 g of protein in 2,000 kcal genuinely has no room for a sweet breakfast. */
const HIGH_PROTEIN: MacroTargets = {
  energy_kcal: 2000, protein_g: 175, carbs_g: 175, fat_g: 66.7,
};

const options = (targets: MacroTargets, overrides: Record<string, unknown> = {}) => ({
  days: [0], slots: SLOTS, targets, savedDishes: [], includeSavedDishes: false,
  includeMenuDishes: true, includeComposed: true, dailyBudgetIdr: null,
  preferences: DEFAULT_PREFERENCES, seed: 1, ...overrides,
}) as Parameters<typeof generatePlan>[0];

const menuCandidate = (recipeId: string) =>
  negritaMenuCandidate(menuRecipes.find((recipe) => recipe.recipe_id === recipeId)!)!;

const lockedBreakfast = (targets: MacroTargets, recipeId: string) =>
  generateDayWithLockedMeal(options(targets), {
    slot: "Breakfast", candidateId: menuCandidate(recipeId).id,
  });

const generated = new Map<string, GeneratedDay[]>();
const week = (targets: MacroTargets, seed = 1): GeneratedDay[] => {
  const key = JSON.stringify([targets, seed]);
  const hit = generated.get(key);
  if (hit) return hit;
  const days = generatePlan(options(targets, { days: WEEK, seed }));
  generated.set(key, days);
  return days;
};

const breakfastsOf = (days: GeneratedDay[]) =>
  days.map((day) => day.meals.find((meal) => meal.slot === "Breakfast")!);
const distinct = (values: string[]) => new Set(values).size;
const mostRepeated = (values: string[]) =>
  Math.max(...[...new Set(values)].map((value) =>
    values.filter((other) => other === value).length));
const consecutive = (values: string[]) =>
  values.filter((value, index) => index > 0 && values[index - 1] === value);

describe("a large breakfast is judged by the day it can produce", () => {
  it.each(LARGE_BREAKFASTS)("solves a whole compliant day around %s", (recipeId) => {
    const candidate = menuCandidate(recipeId);
    const day = lockedBreakfast(BALANCED, recipeId);

    expect(day, `${recipeId} produced no day at all`).not.toBeNull();
    expect(day!.meals[0].name).toBe(candidate.displayName);
    // Used whole, on its published macros — the search cannot resize it, which
    // is exactly why it needs the rest of the day solved around it.
    expect(day!.meals[0].macros).toEqual(candidate.optimizerMacros);
    expect(day!.unfilledSlots).toEqual([]);
    expect(day!.adherence.compliant,
      `${recipeId}: ${day!.adherence.classification}`).toBe(true);
  });

  it("lets breakfast take more than half the day and the rest compensate", () => {
    const day = lockedBreakfast(BALANCED, "special_protein_pancake")!;
    const breakfast = day.meals[0].macros;
    const rest = day.meals.slice(1).reduce((sum, meal) => sum + meal.macros.energy_kcal, 0);

    expect(breakfast.energy_kcal).toBeGreaterThan(BALANCED.energy_kcal / 2);
    expect(rest).toBeLessThan(breakfast.energy_kcal);
    expect(day.adherence.compliant).toBe(true);
  });

  it("drops the snack when the day adds up better without one", () => {
    // 1,175 kcal of waffle out of 1,800 leaves 625 for the rest of the day. A
    // fourth meal does not fit in that, and the day does not need one.
    const day = lockedBreakfast(LIGHT, "protein_bountiful_fruit_waffle")!;

    expect(day.meals.map((meal) => meal.slot)).toEqual(["Breakfast", "Lunch", "Dinner"]);
    expect(day.skippedSlots).toEqual(["Snack"]);
    expect(day.unfilledSlots, "a skipped snack is not an unfilled slot").toEqual([]);
    expect(day.adherence.classification).toBe("Within tolerance");
    expect(day.adherence.compliant, "three meals still make a complete day").toBe(true);
  });

  it("says so plainly where no day adds up, rather than staying silent", () => {
    // At 175 g of protein a 1,095 kcal pancake leaves 125 g of protein to find
    // in 18 g of carbohydrate. Nothing on the menu closes that, and the honest
    // answer is a Best effort day — not an unfilled slot, and not a pretence.
    const day = lockedBreakfast(HIGH_PROTEIN, "special_protein_pancake")!;

    expect(day.meals[0].name).toMatch(/Pancake/);
    expect(day.unfilledSlots).toEqual([]);
    expect(day.adherence.classification).toBe("Best effort");
    expect(day.adherence.failureDimensions.length).toBeGreaterThan(0);
  });
});

describe("a day that was proven feasible survives into the pool", () => {
  it("keeps a locked-feasible large breakfast among the days the week chooses from", () => {
    const pool = __dayPoolForTests(options(BALANCED));
    const breakfasts = pool.map((day) =>
      day.meals.find((meal) => meal.slot === "Breakfast")?.name ?? "");

    // Proving the day exists and then dropping it before the weekly pass ever
    // sees it is the whole bug: the week can only rotate between days it was
    // given.
    expect(breakfasts.some((name) => SWEET.test(name)),
      `no large breakfast in the pool: ${[...new Set(breakfasts)].join(", ")}`).toBe(true);
    for (const day of pool) {
      expect(day.adherence.compliant, "every day in the pool adheres").toBe(true);
    }
  });
});

describe("the week rotates rather than settling on one answer", () => {
  it("reaches for a large sweet breakfast where compliant days have one", () => {
    const meals = breakfastsOf(week(CARB_HEAVY));
    const names = meals.map((meal) => meal.name);

    expect(names.filter((name) => SWEET.test(name)).length,
      `expected a sweet breakfast among ${names.join(", ")}`).toBeGreaterThanOrEqual(1);
    for (const day of week(CARB_HEAVY)) {
      expect(day.adherence.compliant).toBe(true);
    }
  });

  it("does not let a large breakfast become the new default", () => {
    for (const targets of [LIGHT, CARB_HEAVY]) {
      const meals = breakfastsOf(week(targets));
      const names = meals.map((meal) => meal.name);
      const label = `${targets.energy_kcal} kcal: ${names.join(", ")}`;

      expect(names.filter((name) => SWEET.test(name)).length, label).toBeLessThanOrEqual(4);
      expect(mostRepeated(names), label).toBeLessThanOrEqual(2);
      expect(distinct(names), label).toBeGreaterThanOrEqual(3);
      expect(distinct(meals.map((meal) => meal.dishStyle)), label).toBeGreaterThanOrEqual(3);
      expect(consecutive(names), label).toEqual([]);
    }
  });

  it("shuffles to a different week that obeys the same rules", () => {
    const first = week(LIGHT, 1);
    const second = week(LIGHT, 2);
    const signature = (days: GeneratedDay[]) =>
      days.map((day) => day.meals.map((meal) => meal.name).join("|")).join(" || ");

    expect(signature(second)).not.toEqual(signature(first));
    for (const days of [first, second]) {
      const names = breakfastsOf(days).map((meal) => meal.name);
      expect(mostRepeated(names)).toBeLessThanOrEqual(2);
      expect(consecutive(names)).toEqual([]);
      for (const day of days) {
        expect(day.adherence.compliant, "a shuffle may not cost adherence").toBe(true);
        expect(day.unfilledSlots).toEqual([]);
        expect(day.skippedSlots.filter((slot) => slot !== "Snack")).toEqual([]);
      }
    }
  });
});

/**
 * The same rule on a bounded catalog, where the arithmetic is visible: three
 * fixtures that add up to the target exactly, and a fourth meal that would take
 * the day past it.
 */
describe("an optional slot is genuinely optional", () => {
  const bounded = (candidateFixtures: PlannerCandidate[]) => generatePlan({
    days: [0], slots: SLOTS, targets: COMPLETE_DAY_TARGET, savedDishes: [],
    includeSavedDishes: false, includeMenuDishes: false, includeComposed: false,
    candidateFixtures, dailyBudgetIdr: null, preferences: DEFAULT_PREFERENCES, seed: 1,
  } as Parameters<typeof generatePlan>[0])[0];

  const snack = () => plannerFixture("Yoghurt and berries", "Snack",
    { energy_kcal: 200, protein_g: 15, carbs_g: 20, fat_g: 7 });

  it("finishes in three meals when three meals reach the target", () => {
    const day = bounded([
      plannerFixture("Big breakfast", "Breakfast",
        { energy_kcal: 600, protein_g: 40, carbs_g: 60, fat_g: 20 }),
      plannerFixture("Lunch", "Lunch",
        { energy_kcal: 800, protein_g: 60, carbs_g: 80, fat_g: 28 }),
      plannerFixture("Dinner", "Dinner",
        { energy_kcal: 600, protein_g: 50, carbs_g: 60, fat_g: 22 }),
      snack(),
    ]);

    expect(day.meals.map((meal) => meal.slot)).toEqual(["Breakfast", "Lunch", "Dinner"]);
    expect(day.skippedSlots).toEqual(["Snack"]);
    expect(day.unfilledSlots).toEqual([]);
    expect(day.adherence.classification).toBe("Exact");
    expect(day.adherence.compliant).toBe(true);
  });

  it("keeps the snack when the day needs it to reach the target", () => {
    const day = bounded([
      plannerFixture("Breakfast", "Breakfast",
        { energy_kcal: 600, protein_g: 40, carbs_g: 60, fat_g: 20 }),
      plannerFixture("Lunch", "Lunch",
        { energy_kcal: 700, protein_g: 50, carbs_g: 70, fat_g: 25 }),
      plannerFixture("Dinner", "Dinner",
        { energy_kcal: 500, protein_g: 45, carbs_g: 50, fat_g: 18 }),
      snack(),
    ]);

    expect(day.meals.map((meal) => meal.slot)).toEqual(SLOTS);
    expect(day.skippedSlots).toEqual([]);
    expect(day.adherence.classification).toBe("Exact");
  });

  it("skips a snack slot that has nothing to offer instead of failing the day", () => {
    const day = bounded([
      plannerFixture("Big breakfast", "Breakfast",
        { energy_kcal: 600, protein_g: 40, carbs_g: 60, fat_g: 20 }),
      plannerFixture("Lunch", "Lunch",
        { energy_kcal: 800, protein_g: 60, carbs_g: 80, fat_g: 28 }),
      plannerFixture("Dinner", "Dinner",
        { energy_kcal: 600, protein_g: 50, carbs_g: 60, fat_g: 22 }),
    ]);

    // No snack candidate exists at all. Before, that made the whole day
    // Impossible; a day the person can actually eat is not impossible.
    expect(day.skippedSlots).toEqual(["Snack"]);
    expect(day.unfilledSlots).toEqual([]);
    expect(day.adherence.classification).toBe("Exact");
  });
});
