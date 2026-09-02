import { describe, expect, it } from "vitest";
import {
  adherencePct,
  assignmentBasePrice,
  assignmentItems,
  assignmentMacros,
  assignmentName,
  assignmentPrice,
  assignmentsFor,
  byId,
  dateFor,
  dayTotals,
  formatShortDate,
  isOrphaned,
  newAssignmentId,
  plannedDayCount,
  weekDailyAverage,
  weekPrice,
  weekTotals,
} from "@/lib/clients";
import type { Macros } from "@/types/nutrition";
import type { Assignment, Dish, Plan } from "@/lib/storage/types";
import { planDate } from "@/lib/orders";

/**
 * Plan roll-ups. The rule that matters throughout: a live dish wins whenever it
 * still exists, so editing a dish flows into every plan using it — and the
 * snapshot taken at assignment time is the fallback once it is deleted.
 */

const CHICKEN = "chicken_breast_raw";
const ZERO: Macros = { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
const SNAPSHOT: Macros = { energy_kcal: 500, protein_g: 40, carbs_g: 30, fat_g: 20, fiber_g: 5 };

function dish(over: Partial<Dish> = {}): Dish {
  return {
    id: "d1",
    createdAt: "", updatedAt: "",
    name: "Live dish",
    items: [{ ingredientId: CHICKEN, name: "Chicken", grams: 100, unitId: "g", quantity: 100 }],
    totals: ZERO,
    ...over,
  };
}

function assignment(over: Partial<Assignment> = {}): Assignment {
  return {
    id: "a1", week: 1, day: 0, slot: "Lunch", servings: 1,
    snapshot: { name: "Snapshot name", totals: SNAPSHOT },
    ...over,
  };
}

function plan(assignments: Assignment[]): Plan {
  return {
    id: "p1", createdAt: "", updatedAt: "", ownerUid: "u1",
    title: "My week", targets: null, mealSlots: ["Breakfast", "Lunch"],
    targetMode: "preset", targetPreset: "balanced",
    programStartDate: "2026-08-24", weekCount: 2, assignments,
    status: "draft", submittedWeeks: [],
  };
}

describe("assignmentItems and assignmentName", () => {
  it("prefers the live dish over the snapshot", () => {
    const a = assignment({ dishId: "d1" });
    const dishes = byId([dish({ name: "Renamed" })]);
    expect(assignmentName(a, dishes)).toBe("Renamed");
    expect(assignmentItems(a, dishes)).toHaveLength(1);
  });

  it("falls back to the snapshot name once the dish is deleted", () => {
    const a = assignment({ dishId: "d1" });
    expect(assignmentName(a, byId([]))).toBe("Snapshot name");
    expect(assignmentItems(a, byId([]))).toBeNull();
  });

  it("uses inline items for a generated meal that has no dish", () => {
    const a = assignment({
      items: [{ ingredientId: CHICKEN, name: "Chicken", grams: 200, unitId: "g", quantity: 200 }],
    });
    expect(assignmentItems(a, byId([]))).toHaveLength(1);
    expect(assignmentName(a, byId([]))).toBe("Snapshot name");
  });
});

describe("assignmentMacros", () => {
  it("computes from the live dish, not the stored snapshot", () => {
    const a = assignment({ dishId: "d1" });
    const m = assignmentMacros(a, byId([dish()]));
    expect(m.energy_kcal).toBeCloseTo(106, 6); // live: 100 g chicken
    expect(m.energy_kcal).not.toBeCloseTo(SNAPSHOT.energy_kcal, 6);
  });

  it("uses the snapshot when the dish is gone", () => {
    const a = assignment({ dishId: "d1" });
    expect(assignmentMacros(a, byId([])).energy_kcal).toBe(SNAPSHOT.energy_kcal);
  });

  it("scales by servings", () => {
    const a = assignment({ dishId: "d1", servings: 2.5 });
    expect(assignmentMacros(a, byId([dish()])).energy_kcal).toBeCloseTo(265, 6);
  });
});

describe("isOrphaned", () => {
  it("is true only when a dish-backed assignment has lost its dish", () => {
    expect(isOrphaned(assignment({ dishId: "d1" }), byId([]))).toBe(true);
    expect(isOrphaned(assignment({ dishId: "d1" }), byId([dish()]))).toBe(false);
  });

  it("is false for a generated meal, which carries its own items", () => {
    expect(isOrphaned(assignment(), byId([]))).toBe(false);
    expect(
      isOrphaned(
        assignment({ dishId: "d1", items: [{ ingredientId: CHICKEN, name: "c", grams: 1, unitId: "g", quantity: 1 }] }),
        byId([])
      )
    ).toBe(false);
  });
});

describe("assignmentBasePrice and assignmentPrice", () => {
  it("lets an authoritative price win over summing components", () => {
    // A menu dish is sold for its menu price, not the sum of its parts.
    const a = assignment({ price: { totalIdr: 120_000, complete: true }, dishId: "d1" });
    expect(assignmentBasePrice(a, byId([dish()])).totalIdr).toBe(120_000);
  });

  it("marks an incomplete authoritative price as one unpriced item", () => {
    const a = assignment({ price: { totalIdr: 50_000, complete: false } });
    const base = assignmentBasePrice(a, byId([]));
    expect(base.unpricedCount).toBe(1);
    expect(base.complete).toBe(false);
  });

  it("prices from components when there is no authoritative figure", () => {
    const a = assignment({
      items: [{ ingredientId: CHICKEN, name: "c", grams: 150, unitId: "g", quantity: 150 }],
    });
    expect(assignmentBasePrice(a, byId([])).totalIdr).toBe(30_000);
  });

  it("is unpriced when the dish is gone and there are no items", () => {
    const base = assignmentBasePrice(assignment({ dishId: "d1" }), byId([]));
    expect(base.complete).toBe(false);
    expect(base.unpricedCount).toBe(1);
  });

  it("scales the total by servings but not the unpriced count", () => {
    const a = assignment({ dishId: "d1", servings: 3 });
    const priced = assignmentPrice(a, byId([]));
    expect(priced.unpricedCount).toBe(1); // still one unpriced meal, not three
  });

  it("multiplies a real price by servings", () => {
    const a = assignment({
      servings: 2,
      items: [{ ingredientId: CHICKEN, name: "c", grams: 150, unitId: "g", quantity: 150 }],
    });
    expect(assignmentPrice(a, byId([])).totalIdr).toBe(60_000);
  });
});

describe("assignmentsFor", () => {
  const p = plan([
    assignment({ id: "a1", week: 1, day: 0, slot: "Lunch" }),
    assignment({ id: "a2", week: 1, day: 0, slot: "Breakfast" }),
    assignment({ id: "a3", week: 1, day: 3, slot: "Lunch" }),
    assignment({ id: "a4", week: 2, day: 0, slot: "Lunch" }),
  ]);

  it("filters by week, then optionally by day and slot", () => {
    expect(assignmentsFor(p, 1).map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
    expect(assignmentsFor(p, 1, 0).map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(assignmentsFor(p, 1, 0, "Lunch").map((a) => a.id)).toEqual(["a1"]);
  });

  it("treats day 0 as a real filter, not as absent", () => {
    // `day === undefined` is the "no filter" signal; a falsy 0 must not be.
    expect(assignmentsFor(p, 2, 0)).toHaveLength(1);
  });

  it("is empty for a week with nothing in it", () => {
    expect(assignmentsFor(p, 6)).toEqual([]);
  });
});

describe("totals and averages", () => {
  const p = plan([
    assignment({ id: "a1", day: 0, items: [{ ingredientId: CHICKEN, name: "c", grams: 100, unitId: "g", quantity: 100 }] }),
    assignment({ id: "a2", day: 1, items: [{ ingredientId: CHICKEN, name: "c", grams: 100, unitId: "g", quantity: 100 }] }),
  ]);

  it("totals a day and a week", () => {
    expect(dayTotals(p, 1, 0, byId([])).energy_kcal).toBeCloseTo(106, 6);
    expect(weekTotals(p, 1, byId([])).energy_kcal).toBeCloseTo(212, 6);
  });

  it("averages over all seven days, including the empty ones", () => {
    expect(weekDailyAverage(p, 1, byId([])).energy_kcal).toBeCloseTo(212 / 7, 6);
  });

  it("counts only days that have a meal", () => {
    expect(plannedDayCount(p, 1)).toBe(2);
    expect(plannedDayCount(p, 2)).toBe(0);
  });

  it("prices a week", () => {
    expect(weekPrice(p, 1, byId([])).totalIdr).toBe(60_000);
  });
});

describe("adherencePct", () => {
  it("is a straight percentage of target", () => {
    expect(adherencePct(150, 200)).toBe(75);
    expect(adherencePct(250, 200)).toBe(125);
  });

  it("is 0 rather than Infinity when no target is set", () => {
    expect(adherencePct(150, 0)).toBe(0);
    expect(adherencePct(150, -10)).toBe(0);
  });
});

describe("dateFor", () => {
  const p = plan([]);

  it("walks forward by week and day", () => {
    // UTC, because a program day is a calendar date rather than an instant --
    // the same day for everyone looking at it.
    expect(dateFor(p, 1, 0)?.getUTCDate()).toBe(24);
    expect(dateFor(p, 2, 0)?.getUTCDate()).toBe(31);
  });

  /**
   * The planner grid and the kitchen board used to compute this separately: one
   * built a local-time Date and formatted it with no time zone, the other did
   * calendar arithmetic in UTC and rendered in Bali. Same screen, two calendars,
   * for anybody not sitting in Bali. There is one implementation now, and this
   * is what holds it that way.
   */
  it("agrees with the date the kitchen is given, for every day of the program", () => {
    for (let week = 1; week <= 4; week += 1) {
      for (let day = 0; day < 7; day += 1) {
        expect(dateFor(p, week, day)?.toISOString().slice(0, 10), `week ${week} day ${day}`)
          .toBe(planDate(p, week, day));
      }
    }
  });

  it("renders the calendar day whatever zone the viewer is in", () => {
    // Formatted in UTC, so this is the assertion in any zone the runner uses.
    expect(formatShortDate(dateFor(p, 1, 0))).toBe("Aug 24");
    expect(formatShortDate(dateFor(p, 2, 6))).toBe("Sep 6");
  });

  it("refuses a date that only looks like one, rather than rolling it forward", () => {
    // JavaScript would turn February 31 into March 3 without a word.
    expect(dateFor({ ...p, programStartDate: "2026-02-31" }, 1, 0)).toBeNull();
  });

  it("returns null for a malformed start date instead of an Invalid Date", () => {
    expect(dateFor({ ...p, programStartDate: "" }, 1, 0)).toBeNull();
    expect(dateFor({ ...p, programStartDate: "nonsense" }, 1, 0)).toBeNull();
    expect(dateFor({ ...p, programStartDate: "2026-08" }, 1, 0)).toBeNull();
  });

  it("formatShortDate is empty for a null date", () => {
    expect(formatShortDate(null)).toBe("");
  });
});

describe("byId", () => {
  it("indexes dishes and survives an empty list", () => {
    expect(byId([dish({ id: "x" })]).get("x")?.id).toBe("x");
    expect(byId([]).size).toBe(0);
  });
});

describe("newAssignmentId", () => {
  it("produces unique ids", () => {
    const ids = new Set(Array.from({ length: 200 }, newAssignmentId));
    expect(ids.size).toBe(200);
  });
});
