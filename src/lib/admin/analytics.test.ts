import { describe, expect, it } from "vitest";
import {
  customerRollup,
  favouriteMeals,
  periodStats,
  retention,
  revenueByWeek,
  revenueTotals,
  toCsv,
  type CustomerRow,
} from "@/lib/admin/analytics";
import { periodRange } from "@/lib/orderStats";
import { addDays, baliToday, baliWeekStart } from "@/lib/format";
import type { Order, OrderStatus, UserProfile } from "@/lib/storage/types";

/**
 * The owner's numbers. Cancelled and rejected orders are not revenue, and the
 * three revenue figures are deliberately separate — reporting one number means
 * either counting money that never arrived or ignoring work already done.
 */

const EMPTY_MACROS = { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };

/**
 * One day holding `meals` single-serving line items.
 *
 * The fixture used to pass `days: []` alongside a `mealCount`, which is a shape
 * no real order has -- every meal an order carries lives in `days`. Meals are
 * counted from there now, so a fixture that leaves it empty would assert against
 * a field nothing reads.
 */
function dayOf(meals: number, servings = 1) {
  return [{
    date: "2026-08-24",
    fulfilment: { mode: "pickup" as const, time: "12:00" },
    meals: Array.from({ length: meals }, (_, i) => ({
      assignmentId: `a${i}`, slot: "Lunch", name: "Meal", servings,
      items: [], totals: EMPTY_MACROS, priceIdr: 0,
    })),
  }];
}

function order(over: Partial<Order> = {}): Order {
  const mealCount = over.mealCount ?? 5;
  return {
    id: "o1", createdAt: "", updatedAt: "",
    restaurantId: "negrita", userId: "u1", planId: "p1",
    weekNumber: 1, weekStartDate: "2026-08-24",
    status: "submitted",
    customer: { name: "Mario", email: "m@example.com" },
    days: dayOf(mealCount),
    totals: EMPTY_MACROS,
    priceIdr: 100_000,
    mealCount,
    payment: { status: "unpaid", method: "cash", amountIdr: 100_000 },
    submittedAt: "2026-08-20T00:00:00.000Z",
    lockedAt: "2026-08-22T10:00:00.000Z",
    statusHistory: [],
    ...over,
  };
}

function user(over: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "u1", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "",
    uid: "u1", email: "m@example.com", displayName: "Mario",
    role: "client", rid: "negrita",
    ...over,
  };
}

/** The Monday `n` weeks from the current service week. */
const week = (n: number) => addDays(baliWeekStart(), n * 7);

describe("revenueTotals", () => {
  it("separates committed, realised and collected", () => {
    const totals = revenueTotals([
      order({ id: "a", status: "submitted", priceIdr: 100_000 }),
      order({ id: "b", status: "completed", priceIdr: 200_000 }),
      order({
        id: "c", status: "completed", priceIdr: 50_000,
        payment: { status: "paid", method: "cash", amountIdr: 50_000 },
      }),
    ]);
    expect(totals.committedIdr).toBe(350_000);
    expect(totals.realisedIdr).toBe(250_000); // the two completed
    expect(totals.collectedIdr).toBe(50_000); // the one paid
  });

  it.each<OrderStatus>(["cancelled", "rejected"])(
    "excludes a %s order from every figure",
    (status) => {
      const totals = revenueTotals([order({ status, priceIdr: 999_000 })]);
      expect(totals).toEqual({ committedIdr: 0, realisedIdr: 0, collectedIdr: 0 });
    }
  );

  it("is zero for no orders", () => {
    expect(revenueTotals([])).toEqual({
      committedIdr: 0, realisedIdr: 0, collectedIdr: 0,
    });
  });
});

describe("revenueByWeek", () => {
  it("keeps empty weeks so gaps stay visible in the chart", () => {
    const weeks = revenueByWeek([], 4, 2);
    expect(weeks).toHaveLength(7); // 4 back + this week + 2 ahead
    expect(weeks.every((w) => w.idr === 0 && w.orders === 0)).toBe(true);
  });

  it("returns weeks oldest first", () => {
    const weeks = revenueByWeek([], 3, 1);
    const sorted = [...weeks].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    expect(weeks).toEqual(sorted);
  });

  it("includes future weeks, which is where the live order book lives", () => {
    // Orders are placed before the week they cover, so a window ending today
    // would omit everything currently on the books.
    const weeks = revenueByWeek([], 2, 2);
    expect(weeks.filter((w) => w.weekStart > baliToday()).length).toBeGreaterThan(0);
  });

  it("buckets an order into its service week", () => {
    const thisWeek = revenueByWeek([], 1, 1)[1].weekStart;
    const weeks = revenueByWeek(
      [order({ weekStartDate: thisWeek, priceIdr: 75_000 })],
      1,
      1
    );
    const bucket = weeks.find((w) => w.weekStart === thisWeek)!;
    expect(bucket.idr).toBe(75_000);
    expect(bucket.orders).toBe(1);
  });

  it("carries meals and distinct customers alongside the money", () => {
    const thisWeek = baliWeekStart();
    const bucket = revenueByWeek(
      [
        order({ id: "a", userId: "u1", weekStartDate: thisWeek, mealCount: 5 }),
        order({ id: "b", userId: "u1", weekStartDate: thisWeek, mealCount: 3 }),
        order({ id: "c", userId: "u2", weekStartDate: thisWeek, mealCount: 2 }),
      ],
      1,
      1
    ).find((w) => w.weekStart === thisWeek)!;
    expect(bucket.meals).toBe(10);
    expect(bucket.customers).toBe(2); // u1 ordering twice is still one person
  });

  it("drops an order outside the window rather than mis-bucketing it", () => {
    const weeks = revenueByWeek(
      [order({ weekStartDate: "1999-01-04", priceIdr: 999_000 })],
      2,
      1
    );
    expect(weeks.reduce((n, w) => n + w.idr, 0)).toBe(0);
  });
});

/**
 * "Meals" used to mean two things at once. `summarizeOrder` counted line items
 * and stored that on the order; the kitchen board, the week header and every
 * menu roll-up summed servings. One meal for three showed as "1 meal" beside a
 * subtotal of 3, and the owner dashboard put a Meals tile next to a Servings
 * tile, computed from the same orders, showing different numbers.
 *
 * Servings won, because it is what gets cooked and what gets paid for. Counting
 * it from `days` rather than changing the stored field is what makes orders
 * placed before that decision read correctly too.
 */
describe("meals are counted as servings, everywhere", () => {
  const forThree = order({
    id: "party", priceIdr: 300_000, mealCount: 2, days: dayOf(2, 3),
  });

  it("counts servings, not line items, in the weekly roll-up", () => {
    const weeks = revenueByWeek([{ ...forThree, weekStartDate: baliWeekStart() }], 1, 0);
    const thisWeek = weeks.find((w) => w.weekStart === baliWeekStart());
    // Two line items of three servings each. The stored mealCount says 2.
    expect(forThree.mealCount).toBe(2);
    expect(thisWeek?.meals).toBe(6);
  });

  it("agrees with itself across the dashboard", () => {
    const scoped = [forThree];
    const people = [user({ uid: "u1" })];
    const stats = periodStats(people, scoped, scoped, periodRange("all"), baliToday());
    const rows = customerRollup(people, scoped, scoped, baliToday());
    expect(stats.meals).toBe(6);
    expect(rows[0].meals).toBe(6);
  });
});

describe("customerRollup", () => {
  it("keeps a signed-up customer who has never ordered", () => {
    // That gap is exactly what the owner wants to see.
    const rows = customerRollup([user({ uid: "u9" })], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].orders).toBe(0);
    expect(rows[0].avgOrderIdr).toBe(0); // not NaN
  });

  it("joins orders onto their customer and averages them", () => {
    const rows = customerRollup(
      [user({ uid: "u1" })],
      [
        order({ id: "a", userId: "u1", priceIdr: 100_000, mealCount: 5 }),
        order({ id: "b", userId: "u1", priceIdr: 200_000, mealCount: 7 }),
      ]
    );
    expect(rows[0].orders).toBe(2);
    expect(rows[0].meals).toBe(12);
    expect(rows[0].lifetimeIdr).toBe(300_000);
    expect(rows[0].avgOrderIdr).toBe(150_000);
  });

  it("ignores cancelled orders in the join", () => {
    const rows = customerRollup(
      [user({ uid: "u1" })],
      [order({ userId: "u1", status: "cancelled", priceIdr: 500_000 })]
    );
    expect(rows[0].orders).toBe(0);
    expect(rows[0].lifetimeIdr).toBe(0);
  });

  it("sorts by lifetime spend, highest first", () => {
    const rows = customerRollup(
      [user({ uid: "small", id: "small" }), user({ uid: "big", id: "big" })],
      [
        order({ id: "a", userId: "small", priceIdr: 10_000 }),
        order({ id: "b", userId: "big", priceIdr: 900_000 }),
      ]
    );
    expect(rows.map((r) => r.uid)).toEqual(["big", "small"]);
  });

  it("falls back to email then Unknown for a nameless account", () => {
    expect(customerRollup([user({ displayName: "" })], [])[0].name)
      .toBe("m@example.com");
    expect(
      customerRollup([user({ displayName: "", email: "" })], [])[0].name
    ).toBe("Unknown");
  });
});

describe("customer segments", () => {
  it("files an account with no orders as never", () => {
    expect(customerRollup([user()], [])[0].segment).toBe("never");
  });

  it("marks a customer whose first order is recent as new", () => {
    expect(
      customerRollup([user()], [order({ weekStartDate: week(-1) })])[0].segment
    ).toBe("new");
  });

  it("marks an established customer who ordered recently as active", () => {
    const rows = customerRollup([user()], [
      order({ id: "a", weekStartDate: week(-12) }),
      order({ id: "b", weekStartDate: week(-1) }),
    ]);
    expect(rows[0].segment).toBe("active");
  });

  it("treats a week already on the books as active, not lapsed", () => {
    // Orders are placed before the week they cover, so a customer booked in for
    // next week has not drifted away - they are ahead of the kitchen.
    const rows = customerRollup([user()], [
      order({ id: "old", weekStartDate: week(-12) }),
      order({ id: "next", weekStartDate: week(1) }),
    ]);
    expect(rows[0].segment).toBe("active");
  });

  it("marks silence beyond the lapse window as lapsed", () => {
    expect(
      customerRollup([user()], [order({ weekStartDate: week(-8) })])[0].segment
    ).toBe("lapsed");
  });

  it("ignores a cancelled order when segmenting", () => {
    const rows = customerRollup([user()], [
      order({ weekStartDate: week(-1), status: "cancelled" }),
    ]);
    expect(rows[0].segment).toBe("never");
  });

  it("segments on every order read rather than the selected period", () => {
    // Narrowing to a period nobody ordered in must not file everyone as lapsed;
    // that would be a property of the filter, not of the customer.
    const recent = order({ weekStartDate: week(-1), priceIdr: 50_000 });
    const rows = customerRollup([user()], [], [recent]);
    expect(rows[0].segment).not.toBe("lapsed");
    expect(rows[0].orders).toBe(0);
    expect(rows[0].spendIdr).toBe(0);
    expect(rows[0].lifetimeIdr).toBe(50_000);
    expect(rows[0].lastOrderWeek).toBe(week(-1));
  });
});

describe("retention", () => {
  it("counts each segment and lists the lapsed by spend", () => {
    const rows = customerRollup(
      [
        user({ uid: "a", id: "a" }),
        user({ uid: "b", id: "b" }),
        user({ uid: "quiet", id: "quiet" }),
      ],
      [
        order({ id: "1", userId: "a", weekStartDate: week(-8), priceIdr: 100_000 }),
        order({ id: "2", userId: "b", weekStartDate: week(-9), priceIdr: 500_000 }),
      ]
    );
    const summary = retention(rows);
    expect(summary.counts.lapsed).toBe(2);
    expect(summary.counts.never).toBe(1);
    expect(summary.lapsed.map((r) => r.uid)).toEqual(["b", "a"]);
    expect(summary.lapseWeeks).toBe(3);
  });
});

describe("periodStats", () => {
  const all = periodRange("all");

  it("averages only the live orders", () => {
    const stats = periodStats(
      [],
      [
        order({ id: "a", priceIdr: 100_000, mealCount: 5 }),
        order({ id: "b", priceIdr: 300_000, mealCount: 5 }),
        order({ id: "c", status: "cancelled", priceIdr: 900_000, mealCount: 9 }),
      ],
      [],
      all
    );
    expect(stats.orders).toBe(2);
    expect(stats.revenueIdr).toBe(400_000);
    expect(stats.avgOrderIdr).toBe(200_000);
    expect(stats.meals).toBe(10);
  });

  it("is zero rather than NaN with nothing to divide", () => {
    const stats = periodStats([], [], [], all);
    expect(stats.avgOrderIdr).toBe(0);
    expect(stats.repeatPct).toBe(0);
  });

  it("counts only weeks from this one onward as on the books", () => {
    const stats = periodStats(
      [],
      [],
      [
        order({ id: "past", weekStartDate: week(-2), priceIdr: 100_000 }),
        order({ id: "next", weekStartDate: week(1), priceIdr: 250_000 }),
      ],
      all
    );
    expect(stats.onTheBooksIdr).toBe(250_000);
  });

  it("reports the share of customers who ordered more than once", () => {
    const stats = periodStats(
      [],
      [
        order({ id: "a", userId: "u1" }),
        order({ id: "b", userId: "u1" }),
        order({ id: "c", userId: "u2" }),
      ],
      [],
      all
    );
    expect(stats.customersOrdered).toBe(2);
    expect(stats.repeatPct).toBe(50);
  });

  it("counts signups inside the window only", () => {
    const thisMonth = baliToday().slice(0, 7);
    const stats = periodStats(
      [
        user({ uid: "in", createdAt: thisMonth + "-02T00:00:00.000Z" }),
        user({ uid: "out", createdAt: "2000-01-01T00:00:00.000Z" }),
      ],
      [],
      [],
      periodRange("month")
    );
    expect(stats.newCustomers).toBe(1);
  });
});

describe("favouriteMeals", () => {
  const withMeals = (names: string[], servings = 1) =>
    order({
      days: [
        {
          date: "2026-08-24",
          fulfilment: { mode: "pickup", time: "12:00" },
          meals: names.map((name, i) => ({
            assignmentId: `a${i}`, slot: "Lunch", name, servings,
            items: [], totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
            priceIdr: 0,
          })),
        },
      ],
    });

  it("ranks by servings, not by appearances", () => {
    const top = favouriteMeals([
      withMeals(["Chicken bowl"], 5),
      withMeals(["Beef bowl"], 1),
      withMeals(["Beef bowl"], 1),
    ]);
    expect(top[0]).toEqual({ name: "Chicken bowl", count: 5 });
  });

  it("respects the top-N limit", () => {
    expect(favouriteMeals([withMeals(["a", "b", "c", "d"])], 2)).toHaveLength(2);
  });

  it("ignores meals inside a cancelled order", () => {
    const dead = withMeals(["Ghost meal"]);
    expect(favouriteMeals([{ ...dead, status: "cancelled" }])).toEqual([]);
  });
});

describe("toCsv", () => {
  const row: CustomerRow = {
    uid: "u1", name: "Mario", email: "m@example.com",
    joined: "2026-08-01", lastLoginAt: undefined,
    logins: 3, orders: 2, meals: 12,
    spendIdr: 300_000, lifetimeIdr: 300_000, avgOrderIdr: 150_000,
    lastOrderWeek: "2026-08-24", segment: "active",
  };

  it("writes a header and one line per row", () => {
    const lines = toCsv([row]).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("Name,Email,Segment,Joined")).toBe(true);
  });

  it("quotes and escapes a name containing a comma, quote or newline", () => {
    // An unescaped comma silently shifts every later column.
    const csv = toCsv([{ ...row, name: 'Sorgente, "Mario"\nJr' }]);
    expect(csv).toContain('"Sorgente, ""Mario""\nJr"');
  });

  it("leaves an ordinary value unquoted", () => {
    expect(toCsv([row]).split("\n")[1].startsWith("Mario,m@example.com")).toBe(true);
  });

  it("renders a missing last login as empty rather than undefined", () => {
    expect(toCsv([row])).not.toContain("undefined");
  });
});
