import { describe, expect, it } from "vitest";
import {
  customerRollup,
  favouriteMeals,
  revenueByWeek,
  revenueTotals,
  toCsv,
  usageSummary,
} from "@/lib/admin/analytics";
import { baliToday } from "@/lib/format";
import type { Order, OrderStatus, UserProfile } from "@/lib/storage/types";

/**
 * The owner's numbers. Cancelled and rejected orders are not revenue, and the
 * three revenue figures are deliberately separate — reporting one number means
 * either counting money that never arrived or ignoring work already done.
 */

function order(over: Partial<Order> = {}): Order {
  return {
    id: "o1", createdAt: "", updatedAt: "",
    restaurantId: "negrita", userId: "u1", planId: "p1",
    weekNumber: 1, weekStartDate: "2026-08-24",
    status: "submitted",
    customer: { name: "Mario", email: "m@example.com" },
    days: [],
    totals: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    priceIdr: 100_000,
    mealCount: 5,
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

  it("drops an order outside the window rather than mis-bucketing it", () => {
    const weeks = revenueByWeek(
      [order({ weekStartDate: "1999-01-04", priceIdr: 999_000 })],
      2,
      1
    );
    expect(weeks.reduce((n, w) => n + w.idr, 0)).toBe(0);
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

describe("usageSummary", () => {
  it("counts active users within the last seven days", () => {
    const now = new Date("2026-08-22T00:00:00.000Z");
    const summary = usageSummary(
      [
        user({ uid: "recent", lastLoginAt: "2026-08-20T00:00:00.000Z" }),
        user({ uid: "stale", lastLoginAt: "2026-06-01T00:00:00.000Z" }),
        user({ uid: "never" }),
      ],
      [],
      now
    );
    expect(summary.customers).toBe(3);
    expect(summary.activeLast7Days).toBe(1);
  });

  it("does not count a cancelled order in this month's revenue", () => {
    const month = baliToday().slice(0, 7);
    const summary = usageSummary(
      [],
      [
        order({ id: "a", submittedAt: `${month}-05T00:00:00.000Z`, priceIdr: 100_000 }),
        order({ id: "b", submittedAt: `${month}-06T00:00:00.000Z`, status: "cancelled", priceIdr: 900_000 }),
      ]
    );
    expect(summary.ordersThisMonth).toBe(1);
    expect(summary.revenueThisMonthIdr).toBe(100_000);
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
  const row = {
    uid: "u1", name: "Mario", email: "m@example.com",
    joined: "2026-08-01", lastLoginAt: undefined,
    logins: 3, orders: 2, meals: 12, lifetimeIdr: 300_000, avgOrderIdr: 150_000,
  };

  it("writes a header and one line per row", () => {
    const lines = toCsv([row]).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("Name,Email,Joined")).toBe(true);
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
