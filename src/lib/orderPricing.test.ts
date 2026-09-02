import { describe, expect, it } from "vitest";
import { buildOrderDays, summarizeOrder } from "@/lib/orders";
import { getAllIngredients, isPriced } from "@/lib/database";
import type { Plan } from "@/lib/storage/types";

/**
 * What the submit screen is allowed to promise about a price.
 *
 * The server refuses an order containing a meal it cannot fully price, and the
 * screen quoting that order rendered a confident total anyway, with the Send
 * button enabled — so the first anyone heard of it was a 400. The README states
 * the rule the app is meant to follow in as many words: show "from Rp ..." or
 * "—" rather than a total that silently omits ingredients. This is the data the
 * screen needs in order to keep that promise.
 */

const EMPTY = { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };

const unpriced = getAllIngredients().find((i) => !isPriced(i));
const priced = getAllIngredients().find((i) => isPriced(i));

const planWith = (ingredientId: string): Plan =>
  ({
    id: "p1", createdAt: "", updatedAt: "", ownerUid: "u1", title: "My week",
    targets: null, targetMode: "preset", mealSlots: ["Lunch"],
    programStartDate: "2026-08-24", weekCount: 1, status: "draft", submittedWeeks: [],
    assignments: [{
      id: "a1", week: 1, day: 0, slot: "Lunch", servings: 2,
      items: [{ ingredientId, name: "Something", grams: 100, unitId: "g", quantity: 100 }],
      snapshot: { name: "Built meal", totals: EMPTY },
    }],
  }) as unknown as Plan;

describe("summarizing an order the customer is about to send", () => {
  it("counts servings as well as line items, and keeps them apart", () => {
    const days = buildOrderDays(planWith(priced!.ingredient_id), 1, new Map(), {});
    const summary = summarizeOrder(days);

    // One meal, ordered for two. These used to be the same field.
    expect(summary.mealCount).toBe(1);
    expect(summary.servingCount).toBe(2);
  });

  it("reports a meal the restaurant cannot price, rather than quoting past it", () => {
    expect(unpriced, "the catalog needs an unpriced ingredient for this").toBeDefined();
    const days = buildOrderDays(planWith(unpriced!.ingredient_id), 1, new Map(), {});
    const summary = summarizeOrder(days);

    expect(days[0].meals[0].priced).toBe(false);
    // This is what the send is now blocked on, and what turns the total into
    // "from Rp ..." instead of a figure that omits an ingredient in silence.
    expect(summary.unpricedMeals).toBe(1);
  });

  it("says nothing is missing when everything is priced", () => {
    const days = buildOrderDays(planWith(priced!.ingredient_id), 1, new Map(), {});
    expect(summarizeOrder(days).unpricedMeals).toBe(0);
    expect(days[0].meals[0].priced).toBe(true);
  });
});
