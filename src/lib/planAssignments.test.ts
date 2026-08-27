import { describe, expect, it } from "vitest";
import {
  assignmentsFromGenerated,
  occupiedSlots,
  slotKey,
} from "@/lib/planAssignments";
import type { GeneratedDay } from "@/lib/mealPlanner";
import type { Assignment } from "@/lib/storage/types";

/**
 * Merging a generated week into the plan.
 *
 * Keeping the existing week used to append a full seven days on top of it, so
 * every slot that already held a meal ended up with two: a week the preview
 * promised at 2,200 kcal a day was saved at twice that, silently.
 */

const NO_MACROS = {
  energy_kcal: 500, protein_g: 40, carbs_g: 50, fat_g: 15, fiber_g: 3,
};

const meal = (slot: string, name: string) => ({
  slot, name, items: [{ ingredientId: "x", name: "X", grams: 100, unitId: "g", quantity: 100 }],
  macros: NO_MACROS,
  price: { totalIdr: 50_000, complete: true, unpricedCount: 0 },
  kind: "ready" as const,
  dishStyle: "plate",
});

const day = (index: number, slots: string[]): GeneratedDay => ({
  day: index,
  meals: slots.map((slot) => meal(slot, `${slot} dish`)),
  macros: NO_MACROS,
  price: { totalIdr: 50_000 * slots.length, complete: true, unpricedCount: 0 },
  unfilledSlots: [],
  skippedSlots: [],
  adherence: {} as GeneratedDay["adherence"],
});

const existing = (over: Partial<Assignment> = {}): Assignment => ({
  id: "old", week: 1, day: 0, slot: "Breakfast", servings: 1,
  items: [], snapshot: { name: "Yesterday's porridge", totals: NO_MACROS },
  ...over,
});

const generated = [day(0, ["Breakfast", "Lunch", "Dinner"])];

describe("assignmentsFromGenerated", () => {
  it("writes every generated meal when nothing is kept", () => {
    const additions = assignmentsFromGenerated(generated, 1);
    expect(additions.map((a) => a.slot)).toEqual(["Breakfast", "Lunch", "Dinner"]);
    expect(additions.every((a) => a.week === 1 && a.day === 0)).toBe(true);
  });

  it("gives every assignment its own id", () => {
    const additions = assignmentsFromGenerated(
      [day(0, ["Breakfast", "Lunch"]), day(1, ["Breakfast", "Lunch"])], 1);
    expect(new Set(additions.map((a) => a.id)).size).toBe(4);
  });

  it("skips a slot that is being kept", () => {
    // The whole point: the existing breakfast stays, and is not joined by a
    // second one.
    const keep = occupiedSlots([existing()], 1);
    const additions = assignmentsFromGenerated(generated, 1, keep);
    expect(additions.map((a) => a.slot)).toEqual(["Lunch", "Dinner"]);
  });

  it("keeps a slot only on the day it is occupied", () => {
    const keep = occupiedSlots([existing({ day: 2 })], 1);
    const additions = assignmentsFromGenerated(
      [day(0, ["Breakfast"]), day(2, ["Breakfast"])], 1, keep);
    expect(additions.map((a) => a.day)).toEqual([0]);
  });
});

describe("occupiedSlots", () => {
  it("only counts the week being generated", () => {
    // A meal in another week must not block this week's slot.
    const keep = occupiedSlots(
      [existing({ week: 2 }), existing({ id: "b", week: 1, slot: "Lunch" })], 1);
    expect([...keep]).toEqual([slotKey(0, "Lunch")]);
  });

  it("is empty for a week with nothing in it", () => {
    expect(occupiedSlots([], 1).size).toBe(0);
  });

  it("does not confuse a slot whose name contains another", () => {
    // "Snack" and "Snack 2" are different slots.
    const keep = occupiedSlots([existing({ slot: "Snack" })], 1);
    expect(keep.has(slotKey(0, "Snack"))).toBe(true);
    expect(keep.has(slotKey(0, "Snack 2"))).toBe(false);
  });
});
