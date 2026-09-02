import { bench, describe } from "vitest";
import { generatePlan, seedSweep } from "@/lib/mealPlanner";
import { DEFAULT_PREFERENCES, type Assignment, type Plan } from "@/lib/storage/types";
import { byId, dayPrice, dayTotals, assignmentsFor } from "@/lib/clients";
import { searchIngredients, getRecipe, menuRecipes } from "@/lib/database";

/**
 * The three hot paths, measured so an optimization has to prove itself.
 *
 *   npm run bench
 *
 * Not part of `npm test`: timings are machine-dependent and would make CI
 * flaky. Run it before and after a change on the same machine.
 */

const CHICKEN = "chicken_breast_raw";
const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];

/** A full six-week program: 6 x 7 x 4 = 168 meals, the realistic ceiling. */
function fullPlan(): Plan {
  const assignments: Assignment[] = [];
  for (let week = 1; week <= 6; week += 1) {
    for (let day = 0; day < 7; day += 1) {
      for (const slot of SLOTS) {
        assignments.push({
          id: `${week}-${day}-${slot}`,
          week, day, slot, servings: 1,
          items: [
            { ingredientId: CHICKEN, name: "Chicken", grams: 150, unitId: "g", quantity: 150 },
          ],
          snapshot: {
            name: "Meal",
            totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
          },
        });
      }
    }
  }
  return {
    id: "p1", createdAt: "", updatedAt: "", ownerUid: "u1",
    title: "My week", targets: { energy_kcal: 2200, protein_g: 160, carbs_g: 220, fat_g: 70 },
    targetMode: "custom",
    mealSlots: SLOTS, programStartDate: "2026-08-24", weekCount: 6,
    assignments, status: "draft", submittedWeeks: [],
  };
}

const PLAN = fullPlan();
const DISHES = byId([]);

const GENERATION = {
  days: [0, 1, 2, 3, 4, 5, 6],
  slots: SLOTS,
  targets: { energy_kcal: 2200, protein_g: 160, carbs_g: 220, fat_g: 70 },
  savedDishes: [],
  includeSavedDishes: false,
  includeMenuDishes: true,
  includeComposed: true,
  dailyBudgetIdr: null,
  preferences: DEFAULT_PREFERENCES,
  seed: 42,
} as Parameters<typeof generatePlan>[0];

/** What Shuffle asks for: several equivalent weeks over one set of options. */
const SHUFFLE_CANDIDATES = 8;

describe("planner", () => {
  bench("generatePlan — 7 days x 4 slots", () => {
    generatePlan(GENERATION);
  });

  /**
   * The two shapes of a seed sweep, which is what Shuffle runs.
   *
   * The seed reaches one line of the planner, so preparing the search once and
   * sweeping is the same answer for a fraction of the work. Both are measured so
   * the difference is a number rather than a claim, and so a regression that
   * reintroduces per-seed preparation shows up here.
   */
  bench(`seed sweep — ${SHUFFLE_CANDIDATES} candidates, prepared once`, () => {
    const sweep = seedSweep(GENERATION);
    for (let seed = 1; seed <= SHUFFLE_CANDIDATES; seed += 1) sweep(seed);
  });

  bench(`seed sweep — ${SHUFFLE_CANDIDATES} candidates, regenerated each time`, () => {
    for (let seed = 1; seed <= SHUFFLE_CANDIDATES; seed += 1) {
      generatePlan({ ...GENERATION, seed });
    }
  });
});

describe("plan views", () => {
  /**
   * What PlanWeekGrid does on every render: seven day totals, seven day
   * prices, and one assignmentsFor per day x slot cell — each a full scan of
   * all 168 assignments.
   */
  bench("week grid render pass", () => {
    for (let day = 0; day < 7; day += 1) {
      dayTotals(PLAN, 1, day, DISHES);
      dayPrice(PLAN, 1, day, DISHES);
      for (const slot of SLOTS) assignmentsFor(PLAN, 1, day, slot);
    }
  });

  /** PlanDayView re-totals all seven days just to label its day picker. */
  bench("day view picker pass", () => {
    for (let day = 0; day < 7; day += 1) dayTotals(PLAN, 1, day, DISHES);
  });
});

describe("database", () => {
  bench("searchIngredients — one keystroke", () => {
    searchIngredients("chick", null);
  });

  bench("getRecipe x 25", () => {
    for (const recipe of menuRecipes) getRecipe(recipe.recipe_id);
  });
});
