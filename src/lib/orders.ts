import type { Macros } from "@/types/nutrition";
import {
  assignmentItems,
  assignmentMacros,
  assignmentName,
  assignmentPrice,
  assignmentsFor,
  planDateIso,
} from "@/lib/clients";
import { EMPTY_MACROS, addMacros } from "@/lib/calc";
import { optionalSlots } from "@/lib/slotSuitability";
import { isWallClockTime } from "@/lib/fulfilmentTime";
import type {
  Dish,
  Fulfilment,
  Order,
  OrderDay,
  OrderMeal,
  Plan,
  PrepTask,
} from "@/lib/storage/types";
import type { RestaurantPricingPolicy } from "@/lib/pricing";

/**
 * Turning a planned week into an order.
 *
 * Imported by the browser to preview what will be sent, and by the
 * `submitOrder` Cloud Function to build what is actually stored. The server
 * runs this over the plan it read itself, so a tampered payload changes
 * nothing — but both sides agree on what the order *means*, which they would
 * not if the server had its own copy of these rules.
 */

/**
 * ISO yyyy-mm-dd for a day of a plan week, computed as a calendar date.
 *
 * Throws where the planner's `dateFor` returns null, because this one runs on
 * the server building an order: a start date that cannot be parsed must stop the
 * submit, not quietly produce a date. Same arithmetic underneath either way.
 */
export function planDate(plan: Plan, week: number, day: number): string {
  const iso = planDateIso(plan, week, day);
  if (!iso) throw new RangeError(`Invalid calendar date: ${plan.programStartDate}`);
  return iso;
}

/** The Monday a plan week begins on. */
export function weekStartDate(plan: Plan, week: number): string {
  return planDate(plan, week, 0);
}

/** Fulfilment choices, keyed by day index (0 = Monday). */
export type FulfilmentByDay = Record<number, Fulfilment>;

export const DEFAULT_FULFILMENT: Fulfilment = { mode: "pickup", time: "12:00" };

/**
 * The meals of one week, grouped by day, with prices and macros resolved.
 *
 * Days with nothing planned are omitted: the kitchen has no use for an empty
 * day, and including them would make the order look larger than it is.
 */
export function buildOrderDays(
  plan: Plan,
  week: number,
  dishes: Map<string, Dish>,
  fulfilment: FulfilmentByDay,
  pricingPolicy: RestaurantPricingPolicy = { markupPct: 0 }
): OrderDay[] {
  const days: OrderDay[] = [];

  for (let day = 0; day < 7; day += 1) {
    const assignments = assignmentsFor(plan, week).filter((a) => a.day === day);
    if (assignments.length === 0) continue;

    const meals: OrderMeal[] = assignments.map((assignment) => {
      const price = assignmentPrice(assignment, dishes, pricingPolicy);
      return {
        assignmentId: assignment.id,
        slot: assignment.slot,
        name: assignmentName(assignment, dishes),
        servings: assignment.servings,
        items: assignmentItems(assignment, dishes) ?? [],
        totals: assignmentMacros(assignment, dishes),
        priceIdr: price.totalIdr,
        // Not stored on the order -- the server rejects an incomplete price, so a
        // stored order can never carry one. It exists so the screen that quotes
        // the total can tell the customer before the server has to.
        priced: price.complete,
      };
    });

    days.push({
      date: planDate(plan, week, day),
      fulfilment: fulfilment[day] ?? DEFAULT_FULFILMENT,
      meals,
    });
  }

  return days;
}

export interface OrderSummary {
  totals: Macros;
  priceIdr: number;
  /**
   * Meals as line items -- one entry per planned slot, whatever its servings.
   *
   * Stored on the order document, so it is kept as it always was. Do not show it
   * as "meals": see `orderServings` below for the number a kitchen and a bill
   * actually mean.
   */
  mealCount: number;
  /** Meals as portions. What is cooked, what is collected, what is charged. */
  servingCount: number;
  dayCount: number;
  /**
   * Meals whose price could not be fully resolved.
   *
   * The server refuses to accept an order containing one, so the submit screen
   * has to know before it quotes a total it is about to have rejected.
   */
  unpricedMeals: number;
}

export function summarizeOrder(days: OrderDay[]): OrderSummary {
  let totals: Macros = { ...EMPTY_MACROS };
  let priceIdr = 0;
  let mealCount = 0;
  let servingCount = 0;
  let unpricedMeals = 0;

  for (const day of days) {
    for (const meal of day.meals) {
      totals = addMacros(totals, meal.totals);
      priceIdr += meal.priceIdr;
      mealCount += 1;
      servingCount += meal.servings;
      if (meal.priced === false) unpricedMeals += 1;
    }
  }

  return { totals, priceIdr, mealCount, servingCount, dayCount: days.length, unpricedMeals };
}

/**
 * Meals in an order, counted as servings.
 *
 * "Meals" meant two different things on the same card: `mealCount` counts line
 * items, while the kitchen board, the week header and every menu roll-up sum
 * servings. One meal for three showed as "1 meal" next to a subtotal of 3.
 * Servings is the honest one -- it is what gets cooked and what gets paid for --
 * and deriving it here rather than changing the stored field means orders placed
 * before this read correctly too.
 */
export function orderServings(order: Pick<Order, "days">): number {
  let servings = 0;
  // Tolerant of a malformed document, because it replaced a plain field read
  // that could not throw. A stored order always carries `days[].meals`, but a
  // customer opening their order list is the wrong place to find out otherwise.
  for (const day of order.days ?? []) {
    for (const meal of day?.meals ?? []) servings += meal.servings ?? 0;
  }
  return servings;
}

/**
 * Slots in the week that have no meal — reported, never silently filled.
 *
 * A snack the day deliberately went without is not one of them. The planner
 * finishes a day in three meals when three meals reach the target and calls it
 * complete; this counted the missing snack as a gap and warned about seven
 * empty slots in a week the planner had just called finished.
 */
export function emptySlots(
  plan: Plan,
  week: number
): { day: number; slot: string }[] {
  const planned = new Set(
    assignmentsFor(plan, week).map((a) => `${a.day}|${a.slot}`)
  );
  const optional = optionalSlots(plan.mealSlots);
  const gaps: { day: number; slot: string }[] = [];

  for (let day = 0; day < 7; day += 1) {
    for (const slot of plan.mealSlots) {
      if (optional.has(slot)) continue;
      if (!planned.has(`${day}|${slot}`)) gaps.push({ day, slot });
    }
  }
  return gaps;
}

/** Delivery needs somewhere to go; pickup does not. */
export function fulfilmentProblems(days: OrderDay[]): string[] {
  const problems: string[] = [];
  for (const day of days) {
    if (!isWallClockTime(day.fulfilment.time)) {
      problems.push(`${day.date}: pick a time.`);
    }
    if (day.fulfilment.mode === "delivery" && !day.fulfilment.address?.trim()) {
      problems.push(`${day.date}: delivery needs an address.`);
    }
  }
  return problems;
}

/**
 * Explodes an order into one task per meal per day.
 *
 * The kitchen's real question is "what has to be ready next, and for whom",
 * which is a per-meal question — so the board reads these directly rather than
 * unpacking orders on every render.
 */
export function prepTasksFor(
  order: Order,
  makeId: (orderId: string, date: string, assignmentId: string) => string
): PrepTask[] {
  const now = new Date().toISOString();

  return order.days.flatMap((day) =>
    day.meals.map((meal) => ({
      id: makeId(order.id, day.date, meal.assignmentId),
      createdAt: now,
      updatedAt: now,
      restaurantId: order.restaurantId,
      orderId: order.id,
      userId: order.userId,
      date: day.date,
      slot: meal.slot,
      readyBy: day.fulfilment.time,
      mode: day.fulfilment.mode,
      customerName: order.customer.name,
      ...(day.fulfilment.address ? { address: day.fulfilment.address } : {}),
      mealName: meal.name,
      servings: meal.servings,
      items: meal.items,
      totals: meal.totals,
      status: "todo" as const,
    }))
  );
}

/**
 * What the kitchen has to have in hand for a set of tasks, by ingredient.
 *
 * Derived rather than stored: it is a different view of the same tasks, and a
 * stored copy would be one more thing to keep in step when a task changes.
 */
export function miseEnPlace(
  tasks: PrepTask[]
): { ingredientId: string; name: string; grams: number }[] {
  const totals = new Map<string, { name: string; grams: number }>();

  for (const task of tasks) {
    for (const item of task.items) {
      const existing = totals.get(item.ingredientId);
      const grams = item.grams * task.servings;
      if (existing) existing.grams += grams;
      else totals.set(item.ingredientId, { name: item.name, grams });
    }
  }

  return [...totals.entries()]
    .map(([ingredientId, v]) => ({ ingredientId, ...v }))
    .sort((a, b) => b.grams - a.grams);
}
