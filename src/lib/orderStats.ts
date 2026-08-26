import type { Order, OrderStatus } from "@/lib/storage/types";
import { LIVE_ORDER_STATUSES } from "@/lib/storage/types";
import { addDays, baliToday, baliWeekStart } from "@/lib/format";

/**
 * Statistics derived from the order book and nothing else.
 *
 * The split from `lib/admin/analytics` is not cosmetic — it mirrors the
 * security rules. `users` is `list: if isAdmin()` in firestore.rules, so a
 * kitchen screen cannot join against profiles even if it wanted to. Everything
 * here reads only orders, which staff are already allowed to see in full, so
 * these functions are safe on a staff screen by construction rather than by
 * review. Anything needing a profile belongs in the admin module instead.
 */

/** Orders that still represent money the restaurant expects to see. */
export const isLiveOrder = (order: Order) =>
  LIVE_ORDER_STATUSES.includes(order.status);

// --- Periods ----------------------------------------------------------------

export type Period = "30d" | "90d" | "month" | "all";

export interface PeriodRange {
  /** Inclusive ISO yyyy-mm-dd service date. */
  from: string;
  /** Inclusive ISO yyyy-mm-dd service date. */
  to: string;
  label: string;
}

/**
 * The window a period covers, in **service dates** rather than order dates.
 *
 * Food is ordered days before it is cooked — that is the whole point of the
 * cutoff — so "this month" has to mean the food served this month, not the
 * orders typed this month. The two disagree by roughly a week, and only the
 * first is a number the kitchen recognises.
 *
 * This month therefore runs to the end of the month and includes weeks not yet
 * cooked. The rolling windows run backwards from today only: a "last 30 days"
 * that included next week would not be the last 30 days.
 */
export function periodRange(
  period: Period,
  today: string = baliToday()
): PeriodRange {
  switch (period) {
    case "30d":
      return { from: addDays(today, -29), to: today, label: "Last 30 days" };
    case "90d":
      return { from: addDays(today, -89), to: today, label: "Last 90 days" };
    case "month": {
      const from = `${today.slice(0, 7)}-01`;
      const [y, m] = from.split("-").map(Number);
      const nextMonth =
        m === 12
          ? `${y + 1}-01-01`
          : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      return { from, to: addDays(nextMonth, -1), label: "This month" };
    }
    case "all":
    default:
      return { from: "0000-01-01", to: "9999-12-31", label: "All time" };
  }
}

/**
 * The orders whose service week falls in the window.
 *
 * Matched on the week's Monday, so a week straddling a month boundary counts
 * once, in the month it started. Splitting it pro-rata would be more precise
 * and would make two adjacent periods disagree about the same order.
 */
export function ordersInPeriod(orders: Order[], range: PeriodRange): Order[] {
  return orders.filter(
    (order) =>
      order.weekStartDate >= range.from && order.weekStartDate <= range.to
  );
}

// --- Menu performance -------------------------------------------------------

export interface MenuRow {
  name: string;
  /** The slot this dish is most often ordered in. */
  slot: string;
  servings: number;
  revenueIdr: number;
  /** Distinct people who have ordered it — one regular is not a hit. */
  customers: number;
  /** Share of all servings in the same set of orders, 0–100. */
  sharePct: number;
}

/**
 * What sells, by servings and by money.
 *
 * Grouped by dish name, because `OrderMeal` records no recipe id — the menu
 * identity is resolved when the order is built and then dropped. A dish
 * renamed on the menu therefore appears as two rows, which the screens using
 * this say out loud rather than quietly merging on a fuzzy match.
 */
export function menuPerformance(orders: Order[]): MenuRow[] {
  const rows = new Map<
    string,
    {
      servings: number;
      revenueIdr: number;
      customers: Set<string>;
      slots: Map<string, number>;
    }
  >();
  let totalServings = 0;

  for (const order of orders) {
    if (!isLiveOrder(order)) continue;
    for (const day of order.days) {
      for (const meal of day.meals) {
        let row = rows.get(meal.name);
        if (!row) {
          row = {
            servings: 0,
            revenueIdr: 0,
            customers: new Set(),
            slots: new Map(),
          };
          rows.set(meal.name, row);
        }
        row.servings += meal.servings;
        // Already scaled by servings when the order was built.
        row.revenueIdr += meal.priceIdr;
        row.customers.add(order.userId);
        row.slots.set(meal.slot, (row.slots.get(meal.slot) ?? 0) + meal.servings);
        totalServings += meal.servings;
      }
    }
  }

  return [...rows.entries()]
    .map(([name, row]) => ({
      name,
      slot: [...row.slots.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
      servings: row.servings,
      revenueIdr: row.revenueIdr,
      customers: row.customers.size,
      sharePct: totalServings
        ? Math.round((row.servings / totalServings) * 1000) / 10
        : 0,
    }))
    .sort((a, b) => b.servings - a.servings || a.name.localeCompare(b.name));
}

// --- Mixes ------------------------------------------------------------------

export interface MixSlice {
  key: string;
  label: string;
  count: number;
  /** 0–100. */
  sharePct: number;
}

function toSlices(
  counts: Map<string, { label: string; count: number }>
): MixSlice[] {
  const total = [...counts.values()].reduce((n, entry) => n + entry.count, 0);
  return [...counts.entries()]
    .map(([key, entry]) => ({
      key,
      label: entry.label,
      count: entry.count,
      sharePct: total ? Math.round((entry.count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Servings per meal slot. Slots are free text, so their own name is the label. */
export function slotMix(orders: Order[]): MixSlice[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const order of orders) {
    if (!isLiveOrder(order)) continue;
    for (const day of order.days) {
      for (const meal of day.meals) {
        const entry = counts.get(meal.slot) ?? {
          label: meal.slot || "Unassigned",
          count: 0,
        };
        entry.count += meal.servings;
        counts.set(meal.slot, entry);
      }
    }
  }
  return toSlices(counts);
}

/** Meals collected versus meals delivered. Chosen per day, so counted per day. */
export function fulfilmentMix(orders: Order[]): MixSlice[] {
  const counts = new Map<string, { label: string; count: number }>([
    ["pickup", { label: "Pickup", count: 0 }],
    ["delivery", { label: "Delivery", count: 0 }],
  ]);
  for (const order of orders) {
    if (!isLiveOrder(order)) continue;
    for (const day of order.days) {
      const entry = counts.get(day.fulfilment.mode);
      if (!entry) continue;
      entry.count += day.meals.reduce((n, meal) => n + meal.servings, 0);
    }
  }
  return toSlices(counts);
}

// --- Kitchen load -----------------------------------------------------------

export interface WeekLoad {
  weekStart: string;
  orders: number;
  meals: number;
  pickup: number;
  delivery: number;
}

/**
 * How much work each service week holds, oldest first, empty weeks kept.
 *
 * Runs forward as well as back for the same reason the revenue chart does:
 * orders are placed before the week they cover, so the weeks the kitchen most
 * needs to plan for are all in the future.
 */
export function weeklyLoad(
  orders: Order[],
  weeksBack = 3,
  weeksAhead = 3
): WeekLoad[] {
  const thisWeek = baliWeekStart();
  const buckets = new Map<string, WeekLoad>();

  for (let i = -weeksBack; i <= weeksAhead; i += 1) {
    const weekStart = addDays(thisWeek, i * 7);
    buckets.set(weekStart, {
      weekStart,
      orders: 0,
      meals: 0,
      pickup: 0,
      delivery: 0,
    });
  }

  for (const order of orders) {
    if (!isLiveOrder(order)) continue;
    const bucket = buckets.get(baliWeekStart(order.weekStartDate));
    if (!bucket) continue; // outside the window
    bucket.orders += 1;
    for (const day of order.days) {
      const meals = day.meals.reduce((n, meal) => n + meal.servings, 0);
      bucket.meals += meals;
      if (day.fulfilment.mode === "delivery") bucket.delivery += meals;
      else bucket.pickup += meals;
    }
  }

  return [...buckets.values()];
}

/** Meals to cook on each of `days` calendar days from `from`, gaps included. */
export function mealsByDay(
  orders: Order[],
  from: string = baliToday(),
  days = 7
): { date: string; meals: number }[] {
  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i += 1) buckets.set(addDays(from, i), 0);

  for (const order of orders) {
    if (!isLiveOrder(order)) continue;
    for (const day of order.days) {
      const current = buckets.get(day.date);
      if (current === undefined) continue;
      buckets.set(
        day.date,
        current + day.meals.reduce((n, meal) => n + meal.servings, 0)
      );
    }
  }

  return [...buckets.entries()].map(([date, meals]) => ({ date, meals }));
}

/**
 * How many orders sit in each status.
 *
 * Counts every status, cancelled and rejected included — this is the kitchen's
 * queue rather than a revenue figure, and an order waiting to be accepted is
 * exactly the thing the board exists to surface.
 */
export function statusCounts(orders: Order[]): Record<OrderStatus, number> {
  const counts: Record<OrderStatus, number> = {
    submitted: 0,
    accepted: 0,
    in_prep: 0,
    ready: 0,
    completed: 0,
    rejected: 0,
    cancelled: 0,
  };
  for (const order of orders) counts[order.status] += 1;
  return counts;
}
