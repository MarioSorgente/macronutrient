import { describe, expect, it } from "vitest";
import { generateDayWithLockedMeal, type GeneratedDay } from "@/lib/mealPlanner";
import { assignmentsFromGenerated } from "@/lib/planAssignments";
import { migratePlan } from "@/lib/storage/index";
import {
  assignmentMacros,
  assignmentPrice,
  byId,
  dayTotals,
  weekPrice,
} from "@/lib/clients";
import { buildOrderDays, DEFAULT_FULFILMENT } from "@/lib/orders";
import { menuRecipes, publishedMenuMacros } from "@/lib/database";
import { negritaMenuCandidate } from "@/lib/plannerCandidates";
import { withMenuIdentity } from "@/lib/menuIdentity";
import { DEFAULT_PREFERENCES, type Assignment, type Dish, type MacroTargets, type Plan }
  from "@/lib/storage/types";

/**
 * A Negrita menu dish has to survive being planned, saved and read back as the
 * same dish.
 *
 * It did not. An assignment stored a price, an ingredient list and a snapshot,
 * but nothing saying *which menu dish it was* — so on the way back the plan
 * re-derived both numbers from the ingredients. The gram quantities are a fit
 * to the published macros rather than the kitchen's recipe, so a Special
 * Protein Pancake came back as 1,139 kcal against the 1,095 the menu sells and
 * the planner had aimed at, and if the stored price was ever missing the same
 * fallback quoted Rp 15,000 for a Rp 89,000 dish — and Rp 130,000 for a
 * Rp 99,000 Geisha, wrong in both directions.
 *
 * Everything here runs the real pipeline against the real menu: generate, apply,
 * serialize, read back through the migration every load goes through.
 */

const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const TARGETS: MacroTargets = {
  energy_kcal: 2000, protein_g: 125, carbs_g: 225, fat_g: 66.7,
};
const NO_DISHES = byId([]);

const recipeOf = (recipeId: string) =>
  menuRecipes.find((recipe) => recipe.recipe_id === recipeId)!;

/** Generate one real day with this menu dish locked into the given slot. */
function generatedDayWith(recipeId: string, slot: string): GeneratedDay {
  const day = generateDayWithLockedMeal({
    days: [0], slots: SLOTS, targets: TARGETS, savedDishes: [],
    includeSavedDishes: false, includeMenuDishes: true, includeComposed: true,
    dailyBudgetIdr: null, preferences: DEFAULT_PREFERENCES, seed: 1,
  } as Parameters<typeof generateDayWithLockedMeal>[0],
  { slot, candidateId: negritaMenuCandidate(recipeOf(recipeId))!.id });
  expect(day, `${recipeId} produced no day`).not.toBeNull();
  return day!;
}

const planWith = (assignments: Assignment[]): Plan => ({
  id: "primary", ownerUid: "", title: "My week",
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
  targets: TARGETS, targetMode: "custom", mealSlots: SLOTS,
  programStartDate: "2026-08-17", weekCount: 1, status: "draft",
  submittedWeeks: [], assignments,
} as unknown as Plan);

/** Saved to a backend and read back: serialized, then through the load path. */
const savedAndReloaded = (plan: Plan): Plan =>
  migratePlan(JSON.parse(JSON.stringify(plan)))!;

/** generate → apply → save → reload, which is the journey that lost the dish. */
function roundTrip(recipeId: string, slot: string) {
  const day = generatedDayWith(recipeId, slot);
  const plan = savedAndReloaded(planWith(assignmentsFromGenerated([day], 1)));
  const assignment = plan.assignments.find((entry) =>
    entry.snapshot.name === recipeOf(recipeId).name)!;
  return { plan, assignment };
}

describe("a menu dish survives generate → apply → save → reload", () => {
  it.each([
    ["special_protein_pancake", "Breakfast", 89_000],
    ["protein_bountiful_fruit_waffle", "Breakfast", 89_000],
    ["oatmeal_banana_peanut_butter", "Breakfast", 99_000],
    ["geisha", "Lunch", 99_000],
  ])("keeps %s at its menu price and published macros", (recipeId, slot, priceIdr) => {
    const recipe = recipeOf(recipeId);
    const { plan, assignment } = roundTrip(recipeId, slot);

    // The identity itself, which is what everything below resolves from.
    expect(assignment.menuRecipeId).toBe(recipeId);
    expect(assignmentPrice(assignment, NO_DISHES).totalIdr).toBe(priceIdr);
    expect(assignmentPrice(assignment, NO_DISHES).complete).toBe(true);
    expect(assignmentMacros(assignment, NO_DISHES)).toEqual(publishedMenuMacros(recipe));

    // And the same numbers once the week is totalled, which is what a person
    // actually reads.
    const totals = dayTotals(plan, 1, 0, NO_DISHES);
    expect(totals.energy_kcal).toBeGreaterThanOrEqual(
      publishedMenuMacros(recipe)!.energy_kcal);
    expect(weekPrice(plan, 1, NO_DISHES).totalIdr).toBeGreaterThanOrEqual(priceIdr);
  });

  it("counts the day the planner's own totals, not a reconstruction of them", () => {
    const day = generatedDayWith("special_protein_pancake", "Breakfast");
    const plan = savedAndReloaded(planWith(assignmentsFromGenerated([day], 1)));

    // The whole point: the day the planner built to hit 2,000 kcal still reads
    // as that day. Reconstructing the pancake from its parts added 44 kcal to
    // this one meal alone.
    const totals = dayTotals(plan, 1, 0, NO_DISHES);
    expect(totals.energy_kcal).toBeCloseTo(day.macros.energy_kcal, 6);
    expect(totals.protein_g).toBeCloseTo(day.macros.protein_g, 6);
    expect(totals.carbs_g).toBeCloseTo(day.macros.carbs_g, 6);
    expect(totals.fat_g).toBeCloseTo(day.macros.fat_g, 6);
  });

  it("sends the kitchen the same prices and macros the plan shows", () => {
    const { plan, assignment } = roundTrip("special_protein_pancake", "Breakfast");
    const [orderDay] = buildOrderDays(plan, 1, NO_DISHES, { 0: DEFAULT_FULFILMENT });
    const meal = orderDay.meals.find((entry) =>
      entry.name === recipeOf("special_protein_pancake").name)!;

    expect(meal.priceIdr).toBe(89_000);
    expect(meal.totals).toEqual(publishedMenuMacros(recipeOf("special_protein_pancake")));
    expect(meal.totals).toEqual(assignmentMacros(assignment, NO_DISHES));
  });

  it("holds the menu price even when the stored price is lost", () => {
    const { assignment } = roundTrip("special_protein_pancake", "Breakfast");
    const withoutPrice = { ...assignment, price: undefined };

    // Component pricing put this at Rp 15,000. The identity is what makes the
    // stored copy unnecessary rather than load-bearing.
    expect(assignmentPrice(withoutPrice, NO_DISHES).totalIdr).toBe(89_000);
    expect(assignmentMacros(withoutPrice, NO_DISHES))
      .toEqual(publishedMenuMacros(recipeOf("special_protein_pancake")));
  });

  it("scales by servings without losing the menu's figures", () => {
    const { assignment } = roundTrip("geisha", "Lunch");
    const double = { ...assignment, servings: 2 };
    const published = publishedMenuMacros(recipeOf("geisha"))!;

    expect(assignmentPrice(double, NO_DISHES).totalIdr).toBe(198_000);
    expect(assignmentMacros(double, NO_DISHES).energy_kcal)
      .toBeCloseTo(published.energy_kcal * 2, 6);
  });
});

describe("meals planned before menu identity existed", () => {
  /** What the old apply path wrote: a copy of everything, an id for nothing. */
  const legacy = (recipeId: string, overrides: Partial<Assignment> = {}): Assignment => {
    const candidate = negritaMenuCandidate(recipeOf(recipeId))!;
    return {
      id: `legacy-${recipeId}`, week: 1, day: 0, slot: "Breakfast", servings: 1,
      items: candidate.breakdown.map((item) => ({
        ingredientId: item.ingredientId, name: item.name, grams: item.grams,
        unitId: "g", quantity: item.grams,
      })),
      price: { totalIdr: candidate.price.totalIdr, complete: true },
      snapshot: { name: candidate.displayName, totals: candidate.optimizerMacros },
      ...overrides,
    } as Assignment;
  };

  it("get their identity back on load, once, and keep it", () => {
    const plan = savedAndReloaded(planWith([legacy("special_protein_pancake")]));
    const assignment = plan.assignments[0];

    expect(assignment.menuRecipeId).toBe("special_protein_pancake");
    expect(assignmentPrice(assignment, NO_DISHES).totalIdr).toBe(89_000);
    expect(assignmentMacros(assignment, NO_DISHES))
      .toEqual(publishedMenuMacros(recipeOf("special_protein_pancake")));
    // Idempotent: reloading an already-identified plan changes nothing.
    expect(savedAndReloaded(plan).assignments[0]).toEqual(assignment);
  });

  it("does not claim a meal that only started as a menu dish", () => {
    // Same name, one ingredient adjusted by a gram. Somebody changed it, so it
    // is theirs now, and it is priced and counted as what it is made of.
    const tweaked = legacy("special_protein_pancake");
    const items = tweaked.items!.map((item, index) =>
      index === 0 ? { ...item, grams: item.grams + 1 } : item);

    expect(withMenuIdentity({ ...tweaked, items }).menuRecipeId).toBeUndefined();
  });

  it("does not claim a meal whose name is not a menu dish", () => {
    const renamed = legacy("special_protein_pancake",
      { snapshot: { name: "My pancakes", totals: { energy_kcal: 0, protein_g: 0,
        carbs_g: 0, fat_g: 0, fiber_g: 0 } } });

    expect(withMenuIdentity(renamed).menuRecipeId).toBeUndefined();
  });

  it("leaves a saved dish alone", () => {
    const saved = legacy("special_protein_pancake", { dishId: "a-saved-dish" });
    expect(withMenuIdentity(saved).menuRecipeId).toBeUndefined();
  });
});

describe("everything that is not a menu dish is unchanged", () => {
  it("prices and counts a composed meal from its components", () => {
    const day = generatedDayWith("special_protein_pancake", "Breakfast");
    const composed = day.meals.find((meal) => meal.kind === "composed")!;
    const plan = savedAndReloaded(planWith(assignmentsFromGenerated([day], 1)));
    const assignment = plan.assignments.find((entry) =>
      entry.snapshot.name === composed.name)!;

    expect(assignment.menuRecipeId).toBeUndefined();
    expect(assignmentPrice(assignment, NO_DISHES).totalIdr)
      .toBe(composed.price.totalIdr);
    expect(assignmentMacros(assignment, NO_DISHES).energy_kcal)
      .toBeCloseTo(composed.macros.energy_kcal, 6);
  });

  it("still follows a saved dish when the dish changes", () => {
    const dish: Dish = {
      id: "saved-1", name: "My chicken plate", createdAt: "", updatedAt: "",
      items: [{ ingredientId: "chicken_breast_raw", name: "Chicken", grams: 200,
        unitId: "g", quantity: 200 }],
      totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    } as unknown as Dish;
    const assignment = {
      id: "a1", week: 1, day: 0, slot: "Lunch", servings: 1, dishId: dish.id,
      snapshot: { name: dish.name, totals: { energy_kcal: 1, protein_g: 1,
        carbs_g: 1, fat_g: 1, fiber_g: 1 } },
    } as unknown as Assignment;

    // Live dish wins over the snapshot, exactly as before.
    expect(assignmentMacros(assignment, byId([dish])).energy_kcal).toBeGreaterThan(100);
    expect(assignmentPrice(assignment, byId([dish])).totalIdr).toBeGreaterThan(0);
  });
});
