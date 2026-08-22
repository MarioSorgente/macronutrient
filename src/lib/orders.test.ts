import { describe, expect, it } from "vitest";
import {
  DEFAULT_FULFILMENT,
  buildOrderDays,
  emptySlots,
  fulfilmentProblems,
  miseEnPlace,
  planDate,
  prepTasksFor,
  summarizeOrder,
  weekStartDate,
} from "@/lib/orders";
import { byId } from "@/lib/clients";
import type {
  Assignment,
  Dish,
  Order,
  OrderDay,
  Plan,
  PrepTask,
} from "@/lib/storage/types";

/**
 * Turning a planned week into an order and a prep board.
 *
 * Shared verbatim with the `submitOrder` Cloud Function, so these assertions
 * describe what the kitchen is actually committed to cook.
 */

const CHICKEN = "chicken_breast_raw";
const BUCKWHEAT = "buckwheat_cooked";

function assignment(over: Partial<Assignment> = {}): Assignment {
  return {
    id: "a1",
    week: 1,
    day: 0,
    slot: "Lunch",
    servings: 1,
    items: [
      { ingredientId: CHICKEN, name: "Chicken", grams: 150, unitId: "g", quantity: 150 },
    ],
    snapshot: { name: "Chicken plate", totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 } },
    ...over,
  };
}

function plan(over: Partial<Plan> = {}): Plan {
  return {
    id: "p1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ownerUid: "u1",
    title: "My week",
    targets: null,
    mealSlots: ["Breakfast", "Lunch"],
    programStartDate: "2026-08-24", // a Monday
    weekCount: 2,
    assignments: [],
    status: "draft",
    submittedWeeks: [],
    ...over,
  };
}

describe("planDate", () => {
  it("counts forward from the program start as calendar days", () => {
    const p = plan();
    expect(planDate(p, 1, 0)).toBe("2026-08-24");
    expect(planDate(p, 1, 6)).toBe("2026-08-30");
    expect(planDate(p, 2, 0)).toBe("2026-08-31");
  });

  it("crosses a month boundary correctly", () => {
    expect(planDate(plan({ programStartDate: "2026-08-31" }), 1, 1))
      .toBe("2026-09-01");
  });

  it("crosses a year boundary correctly", () => {
    expect(planDate(plan({ programStartDate: "2026-12-28" }), 1, 6))
      .toBe("2027-01-03");
  });

  it("handles a leap day", () => {
    expect(planDate(plan({ programStartDate: "2028-02-28" }), 1, 1))
      .toBe("2028-02-29");
  });

  it("weekStartDate is day 0 of the week", () => {
    const p = plan();
    expect(weekStartDate(p, 2)).toBe(planDate(p, 2, 0));
  });
});

describe("buildOrderDays", () => {
  const dishes = byId([]);

  it("omits days with nothing planned", () => {
    const p = plan({
      assignments: [assignment({ day: 0 }), assignment({ id: "a2", day: 3 })],
    });
    const days = buildOrderDays(p, 1, dishes, {});
    expect(days.map((d) => d.date)).toEqual(["2026-08-24", "2026-08-27"]);
  });

  it("only includes the requested week", () => {
    const p = plan({
      assignments: [assignment({ week: 1 }), assignment({ id: "a2", week: 2 })],
    });
    expect(buildOrderDays(p, 2, dishes, {})).toHaveLength(1);
    expect(buildOrderDays(p, 2, dishes, {})[0].date).toBe("2026-08-31");
  });

  it("defaults fulfilment to pickup at noon when the day has no choice", () => {
    const days = buildOrderDays(plan({ assignments: [assignment()] }), 1, dishes, {});
    expect(days[0].fulfilment).toEqual(DEFAULT_FULFILMENT);
  });

  it("carries the chosen fulfilment through for that day", () => {
    const days = buildOrderDays(
      plan({ assignments: [assignment({ day: 2 })] }),
      1,
      dishes,
      { 2: { mode: "delivery", time: "18:30", address: "Jl. Raya" } }
    );
    expect(days[0].fulfilment.mode).toBe("delivery");
    expect(days[0].fulfilment.address).toBe("Jl. Raya");
  });

  it("resolves macros and price from the live items", () => {
    const days = buildOrderDays(plan({ assignments: [assignment()] }), 1, dishes, {});
    const meal = days[0].meals[0];
    expect(meal.totals.energy_kcal).toBeCloseTo(159, 6); // 106 * 1.5
    expect(meal.priceIdr).toBe(30_000); // one 150 g chicken portion
  });

  it("prefers a live dish's name over the snapshot", () => {
    const dish: Dish = {
      id: "d1",
      createdAt: "", updatedAt: "",
      name: "Renamed dish",
      items: [{ ingredientId: CHICKEN, name: "Chicken", grams: 100, unitId: "g", quantity: 100 }],
      totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    };
    const a = assignment({ dishId: "d1", items: undefined });
    const days = buildOrderDays(plan({ assignments: [a] }), 1, byId([dish]), {});
    expect(days[0].meals[0].name).toBe("Renamed dish");
  });
});

describe("summarizeOrder", () => {
  it("adds up meals, days, macros and price across the week", () => {
    const p = plan({
      assignments: [
        assignment({ day: 0 }),
        assignment({ id: "a2", day: 0, slot: "Breakfast" }),
        assignment({ id: "a3", day: 4 }),
      ],
    });
    const summary = summarizeOrder(buildOrderDays(p, 1, byId([]), {}));
    expect(summary.mealCount).toBe(3);
    expect(summary.dayCount).toBe(2);
    expect(summary.priceIdr).toBe(90_000);
    expect(summary.totals.energy_kcal).toBeCloseTo(477, 6);
  });

  it("is an empty zero for a week with nothing in it", () => {
    const summary = summarizeOrder([]);
    expect(summary).toMatchObject({ mealCount: 0, dayCount: 0, priceIdr: 0 });
    expect(summary.totals.energy_kcal).toBe(0);
  });

  it("scales by servings", () => {
    const p = plan({ assignments: [assignment({ servings: 2 })] });
    const summary = summarizeOrder(buildOrderDays(p, 1, byId([]), {}));
    expect(summary.totals.energy_kcal).toBeCloseTo(318, 6);
    expect(summary.priceIdr).toBe(60_000);
  });
});

describe("fulfilmentProblems", () => {
  const day = (over: Partial<OrderDay>): OrderDay => ({
    date: "2026-08-24",
    fulfilment: { mode: "pickup", time: "12:00" },
    meals: [],
    ...over,
  });

  it("passes a well-formed pickup", () => {
    expect(fulfilmentProblems([day({})])).toEqual([]);
  });

  it("requires an address for delivery", () => {
    const problems = fulfilmentProblems([
      day({ fulfilment: { mode: "delivery", time: "12:00" } }),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("delivery needs an address");
  });

  it("rejects a whitespace-only address", () => {
    expect(
      fulfilmentProblems([
        day({ fulfilment: { mode: "delivery", time: "12:00", address: "   " } }),
      ])
    ).toHaveLength(1);
  });

  it("rejects a malformed time", () => {
    expect(
      fulfilmentProblems([day({ fulfilment: { mode: "pickup", time: "noon" } })])
    ).toHaveLength(1);
  });

  it("reports every bad day, not just the first", () => {
    expect(
      fulfilmentProblems([
        day({ fulfilment: { mode: "pickup", time: "bad" } }),
        day({ date: "2026-08-25", fulfilment: { mode: "delivery", time: "12:00" } }),
      ])
    ).toHaveLength(2);
  });
});

describe("emptySlots", () => {
  it("reports every slot with no meal rather than silently filling it", () => {
    const p = plan({ assignments: [assignment({ day: 0, slot: "Lunch" })] });
    const gaps = emptySlots(p, 1);
    // 7 days x 2 slots, minus the one that is filled.
    expect(gaps).toHaveLength(13);
    expect(gaps).not.toContainEqual({ day: 0, slot: "Lunch" });
    expect(gaps).toContainEqual({ day: 0, slot: "Breakfast" });
  });
});

describe("prepTasksFor", () => {
  const order = (over: Partial<Order> = {}): Order => ({
    id: "o1",
    createdAt: "", updatedAt: "",
    restaurantId: "negrita",
    userId: "u1",
    planId: "p1",
    weekNumber: 1,
    weekStartDate: "2026-08-24",
    status: "submitted",
    customer: { name: "Mario", email: "m@example.com" },
    days: buildOrderDays(
      plan({ assignments: [assignment({ day: 0 }), assignment({ id: "a2", day: 1 })] }),
      1,
      byId([]),
      { 1: { mode: "delivery", time: "18:00", address: "Jl. Raya" } }
    ),
    totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    priceIdr: 0,
    mealCount: 2,
    payment: { status: "unpaid", method: "cash", amountIdr: 0 },
    submittedAt: "",
    lockedAt: "2026-08-22T10:00:00.000Z",
    statusHistory: [],
    ...over,
  });

  it("creates one task per meal per day", () => {
    const tasks = prepTasksFor(order(), (o, d, a) => `${o}_${d}_${a}`);
    expect(tasks).toHaveLength(2);
  });

  it("builds a deterministic id from order, date and assignment", () => {
    const tasks = prepTasksFor(order(), (o, d, a) => `${o}_${d}_${a}`);
    expect(tasks[0].id).toBe("o1_2026-08-24_a1");
  });

  it("copies the day's fulfilment onto the task the kitchen reads", () => {
    const tasks = prepTasksFor(order(), (o, d, a) => `${o}_${d}_${a}`);
    const delivered = tasks.find((t) => t.date === "2026-08-25")!;
    expect(delivered.mode).toBe("delivery");
    expect(delivered.readyBy).toBe("18:00");
    expect(delivered.address).toBe("Jl. Raya");
  });

  it("omits address entirely for a pickup rather than writing undefined", () => {
    // Firestore rejects an explicit undefined; the spread must not emit the key.
    const pickup = prepTasksFor(order(), (o, d, a) => `${o}_${d}_${a}`)
      .find((t) => t.date === "2026-08-24")!;
    expect("address" in pickup).toBe(false);
  });

  it("starts every task as todo", () => {
    const tasks = prepTasksFor(order(), (o, d, a) => `${o}_${d}_${a}`);
    expect(tasks.every((t) => t.status === "todo")).toBe(true);
  });
});

describe("miseEnPlace", () => {
  const task = (over: Partial<PrepTask>): PrepTask => ({
    id: "t", createdAt: "", updatedAt: "",
    restaurantId: "negrita", orderId: "o1", userId: "u1",
    date: "2026-08-24", slot: "Lunch", readyBy: "12:00", mode: "pickup",
    customerName: "Mario", mealName: "Meal", servings: 1,
    items: [], totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    status: "todo",
    ...over,
  });

  it("rolls the same ingredient up across tasks", () => {
    const rolled = miseEnPlace([
      task({ items: [{ ingredientId: CHICKEN, name: "Chicken", grams: 100, unitId: "g", quantity: 100 }] }),
      task({ id: "t2", items: [{ ingredientId: CHICKEN, name: "Chicken", grams: 50, unitId: "g", quantity: 50 }] }),
    ]);
    expect(rolled).toHaveLength(1);
    expect(rolled[0].grams).toBe(150);
  });

  it("multiplies by servings — the kitchen shops for portions, not recipes", () => {
    const rolled = miseEnPlace([
      task({ servings: 3, items: [{ ingredientId: CHICKEN, name: "Chicken", grams: 100, unitId: "g", quantity: 100 }] }),
    ]);
    expect(rolled[0].grams).toBe(300);
  });

  it("sorts heaviest first", () => {
    const rolled = miseEnPlace([
      task({
        items: [
          { ingredientId: CHICKEN, name: "Chicken", grams: 50, unitId: "g", quantity: 50 },
          { ingredientId: BUCKWHEAT, name: "Buckwheat", grams: 400, unitId: "g", quantity: 400 },
        ],
      }),
    ]);
    expect(rolled.map((r) => r.ingredientId)).toEqual([BUCKWHEAT, CHICKEN]);
  });

  it("is empty for no tasks", () => {
    expect(miseEnPlace([])).toEqual([]);
  });
});
