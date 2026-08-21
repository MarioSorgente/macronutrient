import type { Order, UserProfile } from "@/lib/storage/types";
import { LIVE_ORDER_STATUSES } from "@/lib/storage/types";
import { baliToday } from "@/lib/format";

/**
 * The owner's numbers, computed from orders and profiles in the browser.
 *
 * Deliberately not denormalised into counter documents. At Negrita's volume
 * this is one query and a loop, and a stored counter is a second source of
 * truth for revenue that drifts the first time a write fails halfway. Revisit
 * only if the order book reaches a few thousand.
 */

/** Orders that still represent money the restaurant expects to see. */
const isLive = (order: Order) => LIVE_ORDER_STATUSES.includes(order.status);

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
    if (!isLive(order)) continue;
    committedIdr += order.priceIdr;
    if (order.status === "completed") realisedIdr += order.priceIdr;
    if (order.payment?.status === "paid") collectedIdr += order.priceIdr;
  }

  return { committedIdr, realisedIdr, collectedIdr };
}

function isoWeekStart(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const at = Date.UTC(y, m - 1, d);
  const weekday = (new Date(at).getUTCDay() + 6) % 7; // 0 = Monday
  return new Date(at - weekday * 86_400_000).toISOString().slice(0, 10);
}

export interface WeekRevenue {
  weekStart: string;
  idr: number;
  orders: number;
}

/**
 * Committed revenue per service week, oldest first, with empty weeks kept so
 * the chart's gaps stay visible.
 *
 * The window runs forward as well as back. Orders are placed *before* the week
 * they cover — that is the whole point of the cutoff — so a window ending at
 * today would omit every order currently on the books, which is the half the
 * restaurant most wants to see.
 */
export function revenueByWeek(
  orders: Order[],
  weeksBack = 10,
  weeksAhead = 2
): WeekRevenue[] {
  const thisWeek = isoWeekStart(baliToday());
  const buckets = new Map<string, WeekRevenue>();

  const [y, m, d] = thisWeek.split("-").map(Number);
  const anchor = Date.UTC(y, m - 1, d);
  for (let i = -weeksBack; i <= weeksAhead; i += 1) {
    const start = new Date(anchor + i * 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    buckets.set(start, { weekStart: start, idr: 0, orders: 0 });
  }

  for (const order of orders) {
    if (!isLive(order)) continue;
    const bucket = buckets.get(isoWeekStart(order.weekStartDate));
    if (!bucket) continue; // outside the window
    bucket.idr += order.priceIdr;
    bucket.orders += 1;
  }

  return [...buckets.values()];
}

export interface CustomerRow {
  uid: string;
  name: string;
  email: string;
  joined: string;
  lastLoginAt?: string;
  logins: number;
  orders: number;
  meals: number;
  lifetimeIdr: number;
  avgOrderIdr: number;
}

/**
 * One row per person, joining their profile to what they have ordered.
 *
 * Built from the profile list rather than from orders, so someone who signed
 * up and never ordered still appears — that gap is exactly what the owner
 * wants to see.
 */
export function customerRollup(
  users: UserProfile[],
  orders: Order[]
): CustomerRow[] {
  const byUser = new Map<string, Order[]>();
  for (const order of orders) {
    if (!isLive(order)) continue;
    const list = byUser.get(order.userId);
    if (list) list.push(order);
    else byUser.set(order.userId, [order]);
  }

  return users
    .map((user) => {
      const theirs = byUser.get(user.uid) ?? [];
      const lifetimeIdr = theirs.reduce((n, o) => n + o.priceIdr, 0);
      return {
        uid: user.uid,
        name: user.displayName || user.email || "Unknown",
        email: user.email ?? "",
        joined: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        logins: user.loginCount ?? 0,
        orders: theirs.length,
        meals: theirs.reduce((n, o) => n + o.mealCount, 0),
        lifetimeIdr,
        avgOrderIdr: theirs.length ? Math.round(lifetimeIdr / theirs.length) : 0,
      };
    })
    .sort((a, b) => b.lifetimeIdr - a.lifetimeIdr);
}

export interface UsageSummary {
  customers: number;
  newThisMonth: number;
  activeLast7Days: number;
  ordersThisMonth: number;
  revenueThisMonthIdr: number;
  lifetimeIdr: number;
}

function withinDays(iso: string | undefined, days: number, now: Date): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  return Number.isFinite(at) && now.getTime() - at <= days * 86_400_000;
}

export function usageSummary(
  users: UserProfile[],
  orders: Order[],
  now: Date = new Date()
): UsageSummary {
  const monthStart = baliToday().slice(0, 7); // yyyy-mm

  const ordersThisMonth = orders.filter(
    (o) => isLive(o) && o.submittedAt.slice(0, 7) === monthStart
  );

  return {
    customers: users.length,
    newThisMonth: users.filter((u) => u.createdAt?.slice(0, 7) === monthStart)
      .length,
    activeLast7Days: users.filter((u) => withinDays(u.lastLoginAt, 7, now))
      .length,
    ordersThisMonth: ordersThisMonth.length,
    revenueThisMonthIdr: ordersThisMonth.reduce((n, o) => n + o.priceIdr, 0),
    lifetimeIdr: revenueTotals(orders).committedIdr,
  };
}

/** Most-ordered meals, for spotting what the kitchen should keep ready. */
export function favouriteMeals(
  orders: Order[],
  top = 8
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const order of orders) {
    if (!isLive(order)) continue;
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
    "Joined",
    "Last login",
    "Logins",
    "Orders",
    "Meals",
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
        r.joined,
        r.lastLoginAt ?? "",
        r.logins,
        r.orders,
        r.meals,
        r.lifetimeIdr,
        r.avgOrderIdr,
      ]
        .map(escape)
        .join(",")
    ),
  ].join("\n");
}
