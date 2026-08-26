import { describe, expect, it } from "vitest";
import {
  fulfilmentMix,
  mealsByDay,
  menuPerformance,
  ordersInPeriod,
  periodRange,
  slotMix,
  statusCounts,
  weeklyLoad,
} from "@/lib/orderStats";
import { addDays, baliToday, baliWeekStart } from "@/lib/format";
import type { Order, OrderDay, OrderMeal } from "@/lib/storage/types";

/**
 * Figures the kitchen is allowed to see, derived from the order book alone.
 *
 * Cancelled and rejected orders are not work and not money, so they drop out of
 * everything here except the status queue — which exists precisely to show
 * them.
 */

const NO_MACROS = {
  energy_kcal: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: 0,
};

/** The Monday `n` weeks from the current service week. */
const week = (n: number) => addDays(baliWeekStart(), n * 7);

function meal(over: Partial<OrderMeal> = {}): OrderMeal {
  return {
    assignmentId: "a1",
    slot: "Lunch",
    name: "Chicken bowl",
    servings: 1,
    items: [],
    totals: NO_MACROS,
    priceIdr: 50_000,
    ...over,
  };
}

function day(over: Partial<OrderDay> = {}): OrderDay {
  return {
    date: baliWeekStart(),
    fulfilment: { mode: "pickup", time: "12:00" },
    meals: [meal()],
    ...over,
  };
}

function order(over: Partial<Order> = {}): Order {
  return {
    id: "o1",
    createdAt: "",
    updatedAt: "",
    restaurantId: "negrita",
    userId: "u1",
    planId: "p1",
    weekNumber: 1,
    weekStartDate: baliWeekStart(),
    status: "submitted",
    customer: { name: "Mario", email: "m@example.com" },
    days: [day()],
    totals: NO_MACROS,
    priceIdr: 50_000,
    mealCount: 1,
    payment: { status: "unpaid", method: "cash", amountIdr: 50_000 },
    submittedAt: "2026-08-20T00:00:00.000Z",
    lockedAt: "2026-08-22T10:00:00.000Z",
    statusHistory: [],
    ...over,
  };
}

describe("periodRange", () => {
  it("runs this month to the end of the month, upcoming weeks included", () => {
    // The point of measuring by service week: food already ordered for later in
    // the month is this month's revenue.
    const range = periodRange("month", "2026-08-12");
    expect(range.from).toBe("2026-08-01");
    expect(range.to).toBe("2026-08-31");
  });

  it("rolls a December month over into the next year", () => {
    expect(periodRange("month", "2026-12-09").to).toBe("2026-12-31");
  });

  it("runs the rolling windows backwards from today only", () => {
    // A "last 30 days" that included next week would not be the last 30 days.
    const range = periodRange("30d", "2026-08-30");
    expect(range.from).toBe("2026-08-01");
    expect(range.to).toBe("2026-08-30");
  });

  it("leaves all time unbounded in both directions", () => {
    const range = periodRange("all");
    expect(range.from < "1970-01-01").toBe(true);
    expect(range.to > "2999-01-01").toBe(true);
  });

  it("defaults to today in Bali", () => {
    expect(periodRange("30d").to).toBe(baliToday());
  });
});

describe("ordersInPeriod", () => {
  const range = periodRange("month", "2026-08-12");

  it("includes an order on either boundary", () => {
    const kept = ordersInPeriod(
      [
        order({ id: "first", weekStartDate: "2026-08-01" }),
        order({ id: "last", weekStartDate: "2026-08-31" }),
      ],
      range
    );
    expect(kept.map((o) => o.id)).toEqual(["first", "last"]);
  });

  it("drops a week whose Monday falls outside", () => {
    // A week is counted once, in the period it started, rather than split.
    expect(
      ordersInPeriod([order({ weekStartDate: "2026-07-31" })], range)
    ).toEqual([]);
  });
});

describe("menuPerformance", () => {
  it("adds up servings and the money actually charged for them", () => {
    const rows = menuPerformance([
      order({
        days: [day({ meals: [meal({ servings: 2, priceIdr: 100_000 })] })],
      }),
    ]);
    expect(rows[0].servings).toBe(2);
    // priceIdr is already scaled by servings when the order is built.
    expect(rows[0].revenueIdr).toBe(100_000);
  });

  it("counts distinct people, so one regular is not a hit", () => {
    const rows = menuPerformance([
      order({ id: "a", userId: "u1" }),
      order({ id: "b", userId: "u1" }),
      order({ id: "c", userId: "u2" }),
    ]);
    expect(rows[0].servings).toBe(3);
    expect(rows[0].customers).toBe(2);
  });

  it("ranks by servings and gives each dish its share", () => {
    const rows = menuPerformance([
      order({
        days: [
          day({
            meals: [
              meal({ name: "Beef bowl", servings: 3 }),
              meal({ name: "Tofu bowl", servings: 1 }),
            ],
          }),
        ],
      }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Beef bowl", "Tofu bowl"]);
    expect(rows[0].sharePct).toBe(75);
    expect(rows[1].sharePct).toBe(25);
  });

  it("reports the slot a dish is most often ordered in", () => {
    const rows = menuPerformance([
      order({
        days: [
          day({
            meals: [
              meal({ slot: "Dinner", servings: 4 }),
              meal({ slot: "Lunch", servings: 1 }),
            ],
          }),
        ],
      }),
    ]);
    expect(rows[0].slot).toBe("Dinner");
  });

  it("keeps a renamed dish separate rather than guessing", () => {
    // No recipe id survives onto the order, so the name is all there is.
    const rows = menuPerformance([
      order({
        days: [
          day({
            meals: [meal({ name: "Chicken bowl" }), meal({ name: "Chicken Bowl" })],
          }),
        ],
      }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("ignores a cancelled order", () => {
    expect(menuPerformance([order({ status: "cancelled" })])).toEqual([]);
  });

  it("is empty rather than dividing by zero", () => {
    expect(menuPerformance([])).toEqual([]);
  });
});

describe("slotMix", () => {
  it("weights slots by servings, biggest first", () => {
    const slices = slotMix([
      order({
        days: [
          day({
            meals: [
              meal({ slot: "Lunch", servings: 1 }),
              meal({ slot: "Dinner", servings: 3 }),
            ],
          }),
        ],
      }),
    ]);
    expect(slices.map((s) => s.key)).toEqual(["Dinner", "Lunch"]);
    expect(slices[0].count).toBe(3);
    expect(slices[0].sharePct).toBe(75);
  });

  it("labels an unnamed slot rather than showing a blank", () => {
    const slices = slotMix([
      order({ days: [day({ meals: [meal({ slot: "" })] })] }),
    ]);
    expect(slices[0].label).toBe("Unassigned");
  });
});

describe("fulfilmentMix", () => {
  it("counts meals by how the day they belong to reaches people", () => {
    const slices = fulfilmentMix([
      order({
        days: [
          day({
            fulfilment: { mode: "delivery", time: "12:00" },
            meals: [meal({ servings: 3 })],
          }),
          day({ meals: [meal({ servings: 1 })] }),
        ],
      }),
    ]);
    const byKey = Object.fromEntries(slices.map((s) => [s.key, s.count]));
    expect(byKey.delivery).toBe(3);
    expect(byKey.pickup).toBe(1);
  });

  it("keeps both modes present at zero so the bar has an axis", () => {
    expect(fulfilmentMix([]).map((s) => s.key).sort()).toEqual([
      "delivery",
      "pickup",
    ]);
  });
});

describe("weeklyLoad", () => {
  it("keeps empty weeks and runs forward as well as back", () => {
    // Orders arrive before the week they cover, so the weeks the kitchen most
    // needs to plan for are all in the future.
    const load = weeklyLoad([], 3, 3);
    expect(load).toHaveLength(7);
    expect(load.filter((w) => w.weekStart > baliToday()).length).toBeGreaterThan(0);
  });

  it("splits a week into pickup and delivery meals", () => {
    const load = weeklyLoad(
      [
        order({
          weekStartDate: week(0),
          days: [
            day({ meals: [meal({ servings: 2 })] }),
            day({
              fulfilment: { mode: "delivery", time: "18:00" },
              meals: [meal({ servings: 5 })],
            }),
          ],
        }),
      ],
      1,
      1
    );
    const current = load.find((w) => w.weekStart === week(0))!;
    expect(current.orders).toBe(1);
    expect(current.meals).toBe(7);
    expect(current.pickup).toBe(2);
    expect(current.delivery).toBe(5);
  });

  it("drops a week outside the window rather than mis-bucketing it", () => {
    const load = weeklyLoad([order({ weekStartDate: "1999-01-04" })], 1, 1);
    expect(load.reduce((n, w) => n + w.meals, 0)).toBe(0);
  });

  it("ignores a rejected order", () => {
    const load = weeklyLoad(
      [order({ weekStartDate: week(0), status: "rejected" })],
      1,
      1
    );
    expect(load.reduce((n, w) => n + w.orders, 0)).toBe(0);
  });
});

describe("mealsByDay", () => {
  it("returns one entry per day, gaps included", () => {
    const days = mealsByDay([], "2026-08-24", 7);
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe("2026-08-24");
    expect(days[6].date).toBe("2026-08-30");
    expect(days.every((d) => d.meals === 0)).toBe(true);
  });

  it("sums the servings cooked on each date", () => {
    const days = mealsByDay(
      [
        order({
          days: [
            day({ date: "2026-08-25", meals: [meal({ servings: 2 })] }),
            day({ date: "2026-08-25", meals: [meal({ servings: 1 })] }),
          ],
        }),
      ],
      "2026-08-24",
      7
    );
    expect(days.find((d) => d.date === "2026-08-25")!.meals).toBe(3);
  });

  it("ignores a day outside the window", () => {
    const days = mealsByDay(
      [order({ days: [day({ date: "2026-09-30" })] })],
      "2026-08-24",
      7
    );
    expect(days.reduce((n, d) => n + d.meals, 0)).toBe(0);
  });
});

describe("statusCounts", () => {
  it("counts cancelled and rejected too, unlike every other figure here", () => {
    // This is the kitchen queue, not revenue: a rejected order still happened.
    const counts = statusCounts([
      order({ id: "a", status: "submitted" }),
      order({ id: "b", status: "submitted" }),
      order({ id: "c", status: "cancelled" }),
    ]);
    expect(counts.submitted).toBe(2);
    expect(counts.cancelled).toBe(1);
    expect(counts.ready).toBe(0);
  });

  it("returns every status so a lookup is never undefined", () => {
    expect(Object.keys(statusCounts([])).sort()).toEqual([
      "accepted",
      "cancelled",
      "completed",
      "in_prep",
      "ready",
      "rejected",
      "submitted",
    ]);
  });
});
