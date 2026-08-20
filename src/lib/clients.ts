import type { Macros } from "@/types/nutrition";
import { EMPTY_MACROS, addMacros, scaleMacros, sumDishMacros } from "@/lib/calc";
import type { Assignment, Client, Dish, MacroTargets } from "@/lib/storage/types";

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
 * Macros for one assignment. The live dish wins whenever it still exists, so
 * edits to a dish flow through to the plan; the snapshot taken at assignment
 * time is the fallback when the dish has since been deleted.
 */
export function assignmentMacros(
  assignment: Assignment,
  dishes: Map<string, Dish>
): Macros {
  const dish = dishes.get(assignment.dishId);
  const base = dish ? sumDishMacros(dish.items) : assignment.snapshot.totals;
  return scaleMacros(base, assignment.servings);
}

/** Display name for an assignment, preferring the live dish's current name. */
export function assignmentName(
  assignment: Assignment,
  dishes: Map<string, Dish>
): string {
  return dishes.get(assignment.dishId)?.name ?? assignment.snapshot.name;
}

/** True when the underlying dish has been deleted and we're on the snapshot. */
export function isOrphaned(
  assignment: Assignment,
  dishes: Map<string, Dish>
): boolean {
  return !dishes.has(assignment.dishId);
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
