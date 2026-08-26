import { describe, expect, it } from "vitest";
import { mealsPerSlot, withRenamedSlots } from "@/lib/planSlots";
import { assignmentsFor, weekPrice } from "@/lib/clients";
import type { Assignment, Dish, Plan } from "@/lib/storage/types";

/**
 * Renaming a meal slot has to take its meals with it.
 *
 * An assignment names its slot as a string, and every screen finds meals by
 * matching that string against `plan.mealSlots`. So renaming "Snack" left the
 * snacks behind: gone from the planner, no longer counted towards a complete
 * day, and still priced into the week and sent to the kitchen — meals nobody
 * could see and everybody was charged for.
 */

const meal = (slot: string, id: string): Assignment => ({
  id, week: 1, day: 0, slot, servings: 1,
  price: { totalIdr: 50_000, complete: true },
  snapshot: { name: `${slot} plate`,
    totals: { energy_kcal: 400, protein_g: 30, carbs_g: 40, fat_g: 10, fiber_g: 2 } },
} as unknown as Assignment);

const plan = (): Plan => ({
  id: "primary", ownerUid: "", title: "My week",
  createdAt: "", updatedAt: "", targets: null, targetMode: "custom",
  mealSlots: ["Breakfast", "Lunch", "Dinner", "Snack"],
  programStartDate: "2026-08-17", weekCount: 1, status: "draft", submittedWeeks: [],
  assignments: [meal("Breakfast", "a1"), meal("Snack", "a2"), meal("Snack", "a3")],
} as unknown as Plan);

describe("editing the meal slots", () => {
  it("counts what each slot is holding, across the whole plan", () => {
    expect(mealsPerSlot(plan())).toEqual(new Map([["Breakfast", 1], ["Snack", 2]]));
  });

  it("moves the meals when their slot is renamed", () => {
    const renamed = withRenamedSlots(plan().assignments,
      new Map([["Snack", "Afternoon snack"]]));

    expect(renamed.filter((a) => a.slot === "Afternoon snack")).toHaveLength(2);
    expect(renamed.filter((a) => a.slot === "Snack")).toHaveLength(0);
    // Untouched slots are left exactly as they were, same objects and all.
    expect(renamed[0].slot).toBe("Breakfast");
  });

  it("leaves no meal stranded outside the plan's own slots", () => {
    const before = plan();
    const after: Plan = {
      ...before,
      mealSlots: ["Breakfast", "Lunch", "Dinner", "Afternoon snack"],
      assignments: withRenamedSlots(before.assignments,
        new Map([["Snack", "Afternoon snack"]])),
    };
    const dishes = new Map<string, Dish>();

    // What the grid iterates, and what the week is charged for, now agree.
    const visible = after.mealSlots.flatMap((slot) =>
      assignmentsFor(after, 1, 0, slot));
    expect(visible).toHaveLength(after.assignments.length);
    expect(weekPrice(after, 1, dishes).totalIdr)
      .toBe(visible.reduce((sum) => sum + 50_000, 0));
  });

  it("does nothing at all when nothing was renamed", () => {
    const assignments = plan().assignments;
    expect(withRenamedSlots(assignments, new Map())).toBe(assignments);
  });
});
