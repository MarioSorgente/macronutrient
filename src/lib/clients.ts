import type { Macros } from "@/types/nutrition";
import { EMPTY_MACROS, addMacros, scaleMacros, sumDishMacros } from "@/lib/calc";
import { ZERO_PRICE, addPrices, priceItems, type PriceResult } from "@/lib/pricing";
import type {
  Assignment,
  Client,
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
 * Starting point for someone who has not set targets yet — a middle-of-the-road
 * 2000 kcal day. Used by the settings dialog and the auto-planner, which must
 * not disagree about what "default" means.
 */
export const DEFAULT_TARGETS: MacroTargets = {
  energy_kcal: 2000,
  protein_g: 150,
  carbs_g: 200,
  fat_g: 65,
};

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

/** Cost of an assignment, scaled by servings. Null when nothing is priced. */
/**
 * The calculated price of one serving, before any coach mark-up. This is the
 * floor an override may never go below.
 */
export function assignmentBasePrice(
  assignment: Assignment,
  dishes: Map<string, Dish>
): PriceResult {
  // An authoritative price (e.g. a menu dish's own price) wins over summing
  // components, which would otherwise produce a different, partial figure.
  if (assignment.price) {
    return {
      totalIdr: assignment.price.totalIdr,
      unpricedCount: assignment.price.complete ? 0 : 1,
      complete: assignment.price.complete,
    };
  }
  const items = assignmentItems(assignment, dishes);
  if (!items) return { ...ZERO_PRICE, unpricedCount: 1, complete: false };
  return priceItems(items);
}

/** True when the coach has marked this meal up above the menu price. */
export function isMarkedUp(assignment: Assignment): boolean {
  return typeof assignment.priceOverrideIdr === "number";
}

/**
 * Clamp a proposed mark-up to the menu price floor. Returns the value that will
 * actually be stored, so the UI can show the correction rather than silently
 * discarding what was typed.
 */
export function clampMarkUp(proposed: number, floorIdr: number): number {
  if (!Number.isFinite(proposed)) return floorIdr;
  return Math.max(floorIdr, Math.round(proposed));
}

export function assignmentPrice(
  assignment: Assignment,
  dishes: Map<string, Dish>
): PriceResult {
  const base = assignmentBasePrice(assignment, dishes);
  const unit =
    typeof assignment.priceOverrideIdr === "number"
      ? Math.max(assignment.priceOverrideIdr, base.totalIdr)
      : base.totalIdr;
  return {
    totalIdr: unit * assignment.servings,
    unpricedCount: base.unpricedCount,
    complete: base.complete,
  };
}

export function sumAssignmentPrices(
  assignments: Assignment[],
  dishes: Map<string, Dish>
): PriceResult {
  return assignments.reduce<PriceResult>(
    (total, a) => addPrices(total, assignmentPrice(a, dishes)),
    { ...ZERO_PRICE }
  );
}

export function dayPrice(
  client: Client,
  week: number,
  day: number,
  dishes: Map<string, Dish>
): PriceResult {
  return sumAssignmentPrices(assignmentsFor(client, week, day), dishes);
}

export function weekPrice(
  client: Client,
  week: number,
  dishes: Map<string, Dish>
): PriceResult {
  return sumAssignmentPrices(assignmentsFor(client, week), dishes);
}

export function assignmentsFor(
  client: Client,
  week: number,
  day?: number,
  slot?: string
): Assignment[] {
  return client.plan.filter(
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
  client: Client,
  week: number,
  day: number,
  dishes: Map<string, Dish>
): Macros {
  return sumAssignments(assignmentsFor(client, week, day), dishes);
}

export function weekTotals(
  client: Client,
  week: number,
  dishes: Map<string, Dish>
): Macros {
  return sumAssignments(assignmentsFor(client, week), dishes);
}

/** Average per day across the 7 days of a week (including empty days). */
export function weekDailyAverage(
  client: Client,
  week: number,
  dishes: Map<string, Dish>
): Macros {
  return scaleMacros(weekTotals(client, week, dishes), 1 / 7);
}

/** Number of days in the week that have at least one assignment. */
export function plannedDayCount(client: Client, week: number): number {
  const days = new Set(assignmentsFor(client, week).map((a) => a.day));
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
 * Calendar date for a given week/day of the program. Parsed as a local date so
 * the displayed day never shifts across timezones.
 */
export function dateFor(client: Client, week: number, day: number): Date | null {
  const parts = client.programStartDate?.split("-").map(Number);
  if (!parts || parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [year, month, dayOfMonth] = parts;
  const date = new Date(year, month - 1, dayOfMonth);
  date.setDate(date.getDate() + (week - 1) * 7 + day);
  return date;
}

export function formatShortDate(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Stable id for a new assignment. */
export function newAssignmentId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `a-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
