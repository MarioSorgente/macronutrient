import type { Macros } from "@/types/nutrition";
import { EMPTY_MACROS, addMacros, scaleMacros, sumDishMacros } from "@/lib/calc";
import { ZERO_PRICE, addPrices, priceAssignment, type PriceResult, type RestaurantPricingPolicy } from "@/lib/pricing";
import { publishedMenuMacros } from "@/lib/database";
import { assignmentMenuRecipe } from "@/lib/menuIdentity";
import { addDays, parseCalendarDate } from "@/lib/format";
import type {
  Assignment,
  Plan,
  Dish,
  DishItem,
  MacroTargets,
} from "@/lib/storage/types";

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Index dishes by id for the plan helpers below, which all take a lookup map
 * rather than a list so a week's worth of assignments is not a linear scan
 * each time.
 */
export function byId(dishes: Dish[]): Map<string, Dish> {
  return new Map(dishes.map((dish) => [dish.id, dish]));
}

/**
 * Macros for one assignment. The live dish wins whenever it still exists, so
 * edits to a dish flow through to the plan; the snapshot taken at assignment
 * time is the fallback when the dish has since been deleted.
 */
/** The ingredient list backing an assignment, if we still have one. */
export function assignmentItems(
  assignment: Assignment,
  dishes: Map<string, Dish>
): DishItem[] | null {
  if (assignment.dishId) {
    const dish = dishes.get(assignment.dishId);
    if (dish) return dish.items;
  }
  return assignment.items ?? null;
}

export function assignmentMacros(
  assignment: Assignment,
  dishes: Map<string, Dish>
): Macros {
  // A menu dish is counted as the menu publishes it. Its ingredient list is
  // there for the kitchen and for display; adding it up gives a different
  // number, and that number is not what the diner is sold or what the planner
  // built the day from.
  const recipe = assignmentMenuRecipe(assignment);
  const published = recipe ? publishedMenuMacros(recipe) : null;
  if (published) return scaleMacros(published, assignment.servings);

  const items = assignmentItems(assignment, dishes);
  const base = items ? sumDishMacros(items) : assignment.snapshot.totals;
  return scaleMacros(base, assignment.servings);
}

/** Display name for an assignment, preferring the live dish's current name. */
export function assignmentName(
  assignment: Assignment,
  dishes: Map<string, Dish>
): string {
  if (assignment.dishId) {
    const dish = dishes.get(assignment.dishId);
    if (dish) return dish.name;
  }
  return assignment.snapshot.name;
}

/**
 * True when a saved dish backing this assignment has been deleted, so the plan
 * is rendering from its snapshot. Generated meals carry their own items and are
 * never orphaned.
 */
export function isOrphaned(
  assignment: Assignment,
  dishes: Map<string, Dish>
): boolean {
  if (!assignment.dishId) return false;
  return !dishes.has(assignment.dishId) && !assignment.items;
}

/** The menu price of one serving. */
export function assignmentBasePrice(
  assignment: Assignment,
  dishes: Map<string, Dish>,
  policy: RestaurantPricingPolicy = { markupPct: 0 }
): PriceResult {
  return priceAssignment({ ...assignment, servings: 1 }, dishes, policy);
}

/**
 * Cost of an assignment, scaled by servings.
 *
 * There is no per-meal override any more: a diner is quoted Negrita's price,
 * and the restaurant sets its margin once in its own settings rather than
 * meal by meal.
 */
export function assignmentPrice(
  assignment: Assignment,
  dishes: Map<string, Dish>,
  policy: RestaurantPricingPolicy = { markupPct: 0 }
): PriceResult {
  return priceAssignment(assignment, dishes, policy);
}

export function sumAssignmentPrices(
  assignments: Assignment[],
  dishes: Map<string, Dish>,
  policy: RestaurantPricingPolicy = { markupPct: 0 }
): PriceResult {
  return assignments.reduce<PriceResult>(
    (total, a) => addPrices(total, assignmentPrice(a, dishes, policy)),
    { ...ZERO_PRICE }
  );
}

export function dayPrice(
  plan: Plan,
  week: number,
  day: number,
  dishes: Map<string, Dish>,
  policy: RestaurantPricingPolicy = { markupPct: 0 }
): PriceResult {
  return sumAssignmentPrices(assignmentsFor(plan, week, day), dishes, policy);
}

export function weekPrice(
  plan: Plan,
  week: number,
  dishes: Map<string, Dish>,
  policy: RestaurantPricingPolicy = { markupPct: 0 }
): PriceResult {
  return sumAssignmentPrices(assignmentsFor(plan, week), dishes, policy);
}

export function assignmentsFor(
  plan: Plan,
  week: number,
  day?: number,
  slot?: string
): Assignment[] {
  return plan.assignments.filter(
    (a) =>
      a.week === week &&
      (day === undefined || a.day === day) &&
      (slot === undefined || a.slot === slot)
  );
}

export function sumAssignments(
  assignments: Assignment[],
  dishes: Map<string, Dish>
): Macros {
  return assignments.reduce<Macros>(
    (total, a) => addMacros(total, assignmentMacros(a, dishes)),
    { ...EMPTY_MACROS }
  );
}

export function dayTotals(
  plan: Plan,
  week: number,
  day: number,
  dishes: Map<string, Dish>
): Macros {
  return sumAssignments(assignmentsFor(plan, week, day), dishes);
}

export function weekTotals(
  plan: Plan,
  week: number,
  dishes: Map<string, Dish>
): Macros {
  return sumAssignments(assignmentsFor(plan, week), dishes);
}

/** Average per day across the 7 days of a week (including empty days). */
export function weekDailyAverage(
  plan: Plan,
  week: number,
  dishes: Map<string, Dish>
): Macros {
  return scaleMacros(weekTotals(plan, week, dishes), 1 / 7);
}

/** Number of days in the week that have at least one assignment. */
export function plannedDayCount(plan: Plan, week: number): number {
  const days = new Set(assignmentsFor(plan, week).map((a) => a.day));
  return days.size;
}

/** Percentage of a target achieved; 0 when no target is set. */
export function adherencePct(actual: number, target: number): number {
  if (!target || target <= 0) return 0;
  return (actual / target) * 100;
}

export const TARGET_FIELDS: {
  key: keyof MacroTargets;
  macroKey: keyof Macros;
  label: string;
  unit: string;
  tone: string;
}[] = [
  {
    key: "energy_kcal",
    macroKey: "energy_kcal",
    label: "Calories",
    unit: "kcal",
    tone: "bg-tomato",
  },
  {
    key: "protein_g",
    macroKey: "protein_g",
    label: "Protein",
    unit: "g",
    tone: "bg-basil",
  },
  {
    key: "carbs_g",
    macroKey: "carbs_g",
    label: "Carbs",
    unit: "g",
    tone: "bg-gold",
  },
  { key: "fat_g", macroKey: "fat_g", label: "Fat", unit: "g", tone: "bg-tomato-dark" },
];

/**
 * The calendar date a program week and day fall on, as yyyy-mm-dd.
 *
 * The one implementation. `orders.planDate` builds service dates for the order
 * and the kitchen from this, and the planner grid renders from it, so the two
 * cannot describe the same day differently. They very nearly did: this used to
 * build a local-time `Date` and hand it to a bare `toLocaleDateString`, which is
 * precisely what `format.ts` documents as forbidden, while the cutoff line two
 * elements away was rendered in Bali.
 *
 * Null rather than a throw, because a malformed start date reaches this during
 * render. `2026-02-31` is malformed: `parseCalendarDate` rejects it instead of
 * quietly normalising it to March 3.
 */
export function planDateIso(plan: Plan, week: number, day: number): string | null {
  const start = parseCalendarDate(plan.programStartDate);
  if (!start) return null;
  return addDays(plan.programStartDate, (week - 1) * 7 + day);
}

/** The same date as an instant at UTC midnight, for callers that want a Date. */
export function dateFor(plan: Plan, week: number, day: number): Date | null {
  const iso = planDateIso(plan, week, day);
  return iso ? new Date(`${iso}T00:00:00.000Z`) : null;
}

/**
 * "Aug 24" for a calendar date.
 *
 * Formatted in UTC because the value is a calendar date, not an instant: a
 * program day is the same day whoever is looking at it. Rendering it in the
 * viewer zone made the planner disagree with the kitchen board about which day a
 * meal was for, for anybody not sitting in Bali.
 */
export function formatShortDate(date: Date | null): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Stable id for a new assignment. */
export function newAssignmentId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `a-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
