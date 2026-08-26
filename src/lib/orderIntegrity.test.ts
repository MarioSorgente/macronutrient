import { describe, expect, it } from "vitest";
import { buildOrderDays, emptySlots, summarizeOrder, DEFAULT_FULFILMENT } from "@/lib/orders";
import { planWithMenuIdentity } from "@/lib/menuIdentity";
import { assignmentPrice, byId } from "@/lib/clients";
import { menuRecipes, publishedMenuMacros } from "@/lib/database";
import type { Assignment, Dish, Plan } from "@/lib/storage/types";

/**
 * What the diner agrees to and what the kitchen is billed have to be the same
 * number for the same food.
 *
 * The planner recognised a saved copy of a menu dish and priced it at the
 * menu's price. The submit screen and the server did not, so the same meal was
 * quoted at Rp 89,000 in the week and billed from its ingredients at Rp 15,000
 * in the order. One rule, applied everywhere a plan is priced.
 */

const PANCAKE = "special_protein_pancake";
const recipe = menuRecipes.find((entry) => entry.recipe_id === PANCAKE)!;

/** A saved dish that is an untouched copy of the menu's pancake. */
const savedCopy = (): Dish => ({
  id: "saved-pancake", name: recipe.name, createdAt: "", updatedAt: "",
  items: recipe.components.flatMap((component) =>
    component.quantity_g != null
      ? [{ ingredientId: component.ingredient_id, name: component.ingredient_id,
        grams: component.quantity_g, unitId: "g", quantity: component.quantity_g }]
      : []),
  totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
} as unknown as Dish);

const planWith = (assignments: Assignment[], mealSlots = ["Breakfast", "Lunch", "Dinner", "Snack"]): Plan => ({
  id: "primary", ownerUid: "", title: "My week", createdAt: "", updatedAt: "",
  targets: null, targetMode: "custom", mealSlots,
  programStartDate: "2026-08-17", weekCount: 1, status: "draft",
  submittedWeeks: [], assignments,
} as unknown as Plan);

const fromSavedDish = (dish: Dish): Assignment => ({
  id: "a1", week: 1, day: 0, slot: "Breakfast", servings: 1, dishId: dish.id,
  snapshot: { name: dish.name, totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0,
    fat_g: 0, fiber_g: 0 } },
} as unknown as Assignment);

describe("pricing a week the same way everywhere", () => {
  it("uses the identical policy result in browser previews and order construction", () => {
    const assignment = {
      ...fromSavedDish(savedCopy()), dishId: undefined,
      items: [{ ingredientId: "buckwheat_cooked", name: "Buckwheat", grams: 200,
        unitId: "g", quantity: 200 }],
    } as Assignment;
    const policy = { markupPct: 2.345 };
    const preview = assignmentPrice(assignment, new Map(), policy).totalIdr;
    const order = buildOrderDays(
      planWith([assignment]), 1, new Map(), { 0: DEFAULT_FULFILMENT }, policy
    );

    expect(order[0].meals[0].priceIdr).toBe(preview);
    expect(preview).toBe(66_524);
  });

  it("charges the menu price for a saved copy of a menu dish", () => {
    const dish = savedCopy();
    const dishes = byId([dish]);
    const plan = planWith([fromSavedDish(dish)]);

    // Unresolved, it is priced from its parts — which is the bug.
    const naive = summarizeOrder(buildOrderDays(plan, 1, dishes, { 0: DEFAULT_FULFILMENT }));
    expect(naive.priceIdr).not.toBe(89_000);

    // Resolved the way the planner, the submit screen and the server all now
    // resolve it, the order is the order the diner was quoted.
    const resolved = summarizeOrder(
      buildOrderDays(planWithMenuIdentity(plan, dishes), 1, dishes, { 0: DEFAULT_FULFILMENT })
    );
    expect(resolved.priceIdr).toBe(89_000);
    expect(resolved.totals.energy_kcal).toBe(publishedMenuMacros(recipe)!.energy_kcal);
  });

  it("leaves a plan alone when it has nothing to recognise", () => {
    const plan = planWith([]);
    expect(planWithMenuIdentity(plan).assignments).toEqual([]);
  });
});

describe("what counts as a gap before sending", () => {
  const meals = (slots: string[]): Assignment[] => slots.map((slot, index) => ({
    id: `a${index}`, week: 1, day: 0, slot, servings: 1,
    snapshot: { name: slot, totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0,
      fat_g: 0, fiber_g: 0 } },
  } as unknown as Assignment));

  it("does not call a deliberately skipped snack an empty slot", () => {
    // Monday reaches its target in three meals; the planner calls that day
    // complete, and this screen used to warn about it anyway.
    const plan = planWith(meals(["Breakfast", "Lunch", "Dinner"]));
    const monday = emptySlots(plan, 1).filter((gap) => gap.day === 0);

    expect(monday).toEqual([]);
  });

  it("still reports a meal the day actually needs", () => {
    const plan = planWith(meals(["Breakfast", "Lunch"]));
    const monday = emptySlots(plan, 1).filter((gap) => gap.day === 0);

    expect(monday).toEqual([{ day: 0, slot: "Dinner" }]);
  });

  it("treats every slot as needed when a plan is nothing but snacks", () => {
    const plan = planWith(meals(["Snack"]), ["Snack", "Shake"]);
    const monday = emptySlots(plan, 1).filter((gap) => gap.day === 0);

    expect(monday).toEqual([{ day: 0, slot: "Shake" }]);
  });
});
