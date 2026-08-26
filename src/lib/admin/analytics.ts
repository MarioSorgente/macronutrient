import type { Order, UserProfile } from "@/lib/storage/types";
import { addDays, baliToday, baliWeekStart } from "@/lib/format";
import { isLiveOrder, type PeriodRange } from "@/lib/orderStats";

/**
 * The owner's numbers, computed from orders and profiles in the browser.
 *
 * Everything here joins the order book against `users`, which firestore.rules
 * only lets an admin list — so this module is owner-only by construction. The
 * figures staff are allowed to see live in `lib/orderStats` instead.
 *
 * Deliberately not denormalised into counter documents. At Negrita's volume
 * this is one query and a loop, and a stored counter is a second source of
 * truth for revenue that drifts the first time a write fails halfway. Revisit
 * only if the order book reaches a few thousand.
 */

/** A customer who has not ordered for this long has drifted away. */
const LAPSE_WEEKS = 3;
/** A customer whose first order is this recent is still finding their feet. */
const NEW_WEEKS = 4;

export interface RevenueTotals {
  /** Every order not cancelled or rejected — what has been promised. */
  committedIdr: number;
  /** Orders actually marked completed — what was delivered. */
  realisedIdr: number;
  /** Orders recorded as paid. Zero until payments are tracked. */
  collectedIdr: number;
}

/**
 * Three figures, not one.
 *
 * Reporting a single "revenue" number means choosing between counting money
 * that has not arrived and ignoring work already done. Showing committed,
 * realised and collected side by side is the honest version.
 */
export function revenueTotals(orders: Order[]): RevenueTotals {
  let committedIdr = 0;
  let realisedIdr = 0;
  let collectedIdr = 0;

  for (const order of orders) {
    if (!isLiveOrder(order)) continue;
    committedIdr += order.priceIdr;
    if (order.status === "completed") realisedIdr += order.priceIdr;
    if (order.payment?.status === "paid") collectedIdr += order.priceIdr;
  }

  return { committedIdr, realisedIdr, collectedIdr };
}

export interface WeekRevenue {
  weekStart: string;
  idr: number;
  orders: number;
  meals: number;
  /** Distinct people served that week. */
  customers: number;
}

/**
 * Committed revenue per service week, oldest first, with empty weeks kept so
 * the chart's gaps stay visible.
 *
 * The window runs forward as well as back. Orders are placed *before* the week
 * they cover — that is the whole point of the cutoff — so a window ending at
 * today would omit every order currently on the books, which is the half the
 * restaurant most wants to see.
 *
 * Carries meals and customers alongside the money so the same pass feeds all
 * four series the chart can plot.
 */
export function revenueByWeek(
  orders: Order[],
  weeksBack = 10,
  weeksAhead = 2
): WeekRevenue[] {
  const thisWeek = baliWeekStart();
  const buckets = new Map<string, WeekRevenue>();
  const seen = new Map<string, Set<string>>();

  for (let i = -weeksBack; i <= weeksAhead; i += 1) {
    const start = addDays(thisWeek, i * 7);
    buckets.set(start, {
      weekStart: start,
      idr: 0,
      orders: 0,
      meals: 0,
      customers: 0,
    });
    seen.set(start, new Set());
  }

  for (const order of orders) {
    if (!isLiveOrder(order)) continue;
    const week = baliWeekStart(order.weekStartDate);
    const bucket = buckets.get(week);
    if (!bucket) continue; // outside the window
    bucket.idr += order.priceIdr;
    bucket.orders += 1;
    bucket.meals += order.mealCount;
    const people = seen.get(week)!;
    people.add(order.userId);
    bucket.customers = people.size;
  }

  return [...buckets.values()];
}

/**
 * Where a customer sits in their life with the restaurant.
 *
 * `lapsed` is the one worth acting on: someone who used to order every week and
 * quietly stopped looks identical to a happy customer in a lifetime-spend table.
 */
export type Segment = "new" | "active" | "lapsed" | "never";

export const SEGMENT_LABELS: Record<Segment, string> = {
  new: "New",
  active: "Active",
  lapsed: "Lapsed",
  never: "Never ordered",
};

export interface CustomerRow {
  uid: string;
  name: string;
  email: string;
  joined: string;
  lastLoginAt?: string;
  logins: number;
  /** Orders in the selected period. */
  orders: number;
  /** Meals in the selected period. */
  meals: number;
  /** Spend in the selected period. */
  spendIdr: number;
  /** Spend across every order read, regardless of period. */
  lifetimeIdr: number;
  avgOrderIdr: number;
  /** Service week of their most recent order, period ignored. */
  lastOrderWeek?: string;
  segment: Segment;
}

function groupByUser(orders: Order[]): Map<string, Order[]> {
  const byUser = new Map<string, Order[]>();
  for (const order of orders) {
    if (!isLiveOrder(order)) continue;
    const list = byUser.get(order.userId);
    if (list) list.push(order);
    else byUser.set(order.userId, [order]);
  }
  return byUser;
}

/**
 * Which segment a customer is in, given every order they have ever placed.
 *
 * Compared against service weeks, not order dates, so someone booked in for
 * next week counts as active — they have not drifted away, they are simply
 * ahead of the kitchen.
 */
function segmentOf(theirOrders: Order[], today: string): Segment {
  if (theirOrders.length === 0) return "never";

  const weeks = theirOrders.map((order) => baliWeekStart(order.weekStartDate));
  const first = weeks.reduce((a, b) => (a < b ? a : b));
  const last = weeks.reduce((a, b) => (a > b ? a : b));

  const thisWeek = baliWeekStart(today);
  const activeFrom = addDays(thisWeek, -LAPSE_WEEKS * 7);
  const newFrom = addDays(thisWeek, -NEW_WEEKS * 7);

  // Order matters: someone who ordered recently is never "lapsed", and among
  // those, a first order inside the new window makes them new rather than
  // established.
  if (last >= activeFrom) return first >= newFrom ? "new" : "active";
  return "lapsed";
}

/**
 * One row per person, joining their profile to what they have ordered.
 *
 * Built from the profile list rather than from orders, so someone who signed
 * up and never ordered still appears — that gap is exactly what the owner
 * wants to see.
 *
 * Takes two order lists on purpose. `orders` is whatever period the dashboard
 * is showing and drives the money and counts; `allOrders` is everything read,
 * and drives the segment — otherwise narrowing to "last 30 days" would file
 * every customer outside it as lapsed, which is a property of the filter
 * rather than of the customer.
 */
export function customerRollup(
  users: UserProfile[],
  orders: Order[],
  allOrders: Order[] = orders,
  today: string = baliToday()
): CustomerRow[] {
  const inPeriod = groupByUser(orders);
  const ever = groupByUser(allOrders);

  return users
    .map((user) => {
      const theirs = inPeriod.get(user.uid) ?? [];
      const theirsEver = ever.get(user.uid) ?? [];
      const spendIdr = theirs.reduce((n, o) => n + o.priceIdr, 0);
      const weeks = theirsEver.map((o) => baliWeekStart(o.weekStartDate));

      return {
        uid: user.uid,
        name: user.displayName || user.email || "Unknown",
        email: user.email ?? "",
        joined: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        logins: user.loginCount ?? 0,
        orders: theirs.length,
        meals: theirs.reduce((n, o) => n + o.mealCount, 0),
        spendIdr,
        lifetimeIdr: theirsEver.reduce((n, o) => n + o.priceIdr, 0),
        avgOrderIdr: theirs.length ? Math.round(spendIdr / theirs.length) : 0,
        lastOrderWeek: weeks.length
          ? weeks.reduce((a, b) => (a > b ? a : b))
          : undefined,
        segment: segmentOf(theirsEver, today),
      };
    })
    .sort((a, b) => b.lifetimeIdr - a.lifetimeIdr);
}

export interface RetentionSummary {
  counts: Record<Segment, number>;
  /** Customers who used to order and have not for `LAPSE_WEEKS` weeks. */
  lapsed: CustomerRow[];
  /** How many weeks of silence it takes to count as lapsed. */
  lapseWeeks: number;
}

/**
 * The customer base split by where people are in their life with the
 * restaurant, plus the list worth phoning.
 */
export function retention(rows: CustomerRow[]): RetentionSummary {
  const counts: Record<Segment, number> = {
    new: 0,
    active: 0,
    lapsed: 0,
    never: 0,
  };
  for (const row of rows) counts[row.segment] += 1;

  return {
    counts,
    lapsed: rows
      .filter((row) => row.segment === "lapsed")
      .sort((a, b) => b.lifetimeIdr - a.lifetimeIdr),
    lapseWeeks: LAPSE_WEEKS,
  };
}

export interface PeriodStats {
  revenueIdr: number;
  orders: number;
  avgOrderIdr: number;
  meals: number;
  /**
   * Committed revenue for weeks not yet served. Deliberately ignores the
   * selected period — it answers "what is already promised", which a backward
   * looking window cannot.
   */
  onTheBooksIdr: number;
  customersOrdered: number;
  newCustomers: number;
  /** Share of the period's customers who ordered more than once, 0–100. */
  repeatPct: number;
}

/** The headline figures for whichever period the dashboard is showing. */
export function periodStats(
  users: UserProfile[],
  orders: Order[],
  allOrders: Order[],
  range: PeriodRange,
  today: string = baliToday()
): PeriodStats {
  const live = orders.filter(isLiveOrder);
  const byUser = groupByUser(orders);
  const repeat = [...byUser.values()].filter((list) => list.length > 1).length;
  const revenueIdr = live.reduce((n, o) => n + o.priceIdr, 0);
  const thisWeek = baliWeekStart(today);

  return {
    revenueIdr,
    orders: live.length,
    avgOrderIdr: live.length ? Math.round(revenueIdr / live.length) : 0,
    meals: live.reduce((n, o) => n + o.mealCount, 0),
    onTheBooksIdr: allOrders
      .filter((o) => isLiveOrder(o) && baliWeekStart(o.weekStartDate) >= thisWeek)
      .reduce((n, o) => n + o.priceIdr, 0),
    customersOrdered: byUser.size,
    newCustomers: users.filter((user) => {
      const joined = user.createdAt?.slice(0, 10);
      return !!joined && joined >= range.from && joined <= range.to;
    }).length,
    repeatPct: byUser.size ? Math.round((repeat / byUser.size) * 100) : 0,
  };
}

/** Most-ordered meals, for spotting what the kitchen should keep ready. */
export function favouriteMeals(
  orders: Order[],
  top = 8
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const order of orders) {
    if (!isLiveOrder(order)) continue;
    for (const day of order.days) {
      for (const meal of day.meals) {
        counts.set(meal.name, (counts.get(meal.name) ?? 0) + meal.servings);
      }
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, top);
}

/** Rows to CSV. Hand-rolled: one function beats a dependency. */
export function toCsv(rows: CustomerRow[]): string {
  const header = [
    "Name",
    "Email",
    "Segment",
    "Joined",
    "Last order week",
    "Last login",
    "Logins",
    "Orders",
    "Meals",
    "Spend IDR",
    "Lifetime IDR",
    "Avg order IDR",
  ];
  const escape = (value: string | number) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [
    header.join(","),
    ...rows.map((r) =>
      [
        r.name,
        r.email,
        SEGMENT_LABELS[r.segment],
        r.joined,
        r.lastOrderWeek ?? "",
        r.lastLoginAt ?? "",
        r.logins,
        r.orders,
        r.meals,
        r.spendIdr,
        r.lifetimeIdr,
        r.avgOrderIdr,
      ]
        .map(escape)
        .join(",")
    ),
  ].join("\n");
}
