import type { Macros } from "@/types/nutrition";
import {
  assignmentItems,
  assignmentMacros,
  assignmentName,
  assignmentPrice,
  assignmentsFor,
} from "@/lib/clients";
import { EMPTY_MACROS, addMacros } from "@/lib/calc";
import { optionalSlots } from "@/lib/slotSuitability";
import type {
  Dish,
  Fulfilment,
  Order,
  OrderDay,
  OrderMeal,
  Plan,
  PrepTask,
} from "@/lib/storage/types";

/**
 * Turning a planned week into an order.
 *
 * Imported by the browser to preview what will be sent, and by the
 * `submitOrder` Cloud Function to build what is actually stored. The server
 * runs this over the plan it read itself, so a tampered payload changes
 * nothing — but both sides agree on what the order *means*, which they would
 * not if the server had its own copy of these rules.
 */

/** ISO yyyy-mm-dd for a day of a plan week, computed as a calendar date. */
export function planDate(plan: Plan, week: number, day: number): string {
  const [y, m, d] = plan.programStartDate.split("-").map(Number);
  const offset = (week - 1) * 7 + day;
  return new Date(Date.UTC(y, m - 1, d) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
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
  fulfilment: FulfilmentByDay
): OrderDay[] {
  const days: OrderDay[] = [];

  for (let day = 0; day < 7; day += 1) {
    const assignments = assignmentsFor(plan, week).filter((a) => a.day === day);
    if (assignments.length === 0) continue;

    const meals: OrderMeal[] = assignments.map((assignment) => ({
      assignmentId: assignment.id,
      slot: assignment.slot,
      name: assignmentName(assignment, dishes),
      servings: assignment.servings,
      items: assignmentItems(assignment, dishes) ?? [],
      totals: assignmentMacros(assignment, dishes),
      priceIdr: assignmentPrice(assignment, dishes).totalIdr,
    }));

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
  mealCount: number;
  dayCount: number;
}

export function summarizeOrder(days: OrderDay[]): OrderSummary {
  let totals: Macros = { ...EMPTY_MACROS };
  let priceIdr = 0;
  let mealCount = 0;

  for (const day of days) {
    for (const meal of day.meals) {
      totals = addMacros(totals, meal.totals);
      priceIdr += meal.priceIdr;
      mealCount += 1;
    }
  }

  return { totals, priceIdr, mealCount, dayCount: days.length };
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
    if (!/^\d{2}:\d{2}$/.test(day.fulfilment.time)) {
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
