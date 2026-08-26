import { nutritionCatalog } from "@/lib/database";
import { assignmentPrice } from "@/lib/clients";
import type { Dish, DishItem, OrderDay, Plan } from "@/lib/storage/types";
import { HttpError } from "@/lib/server/auth";
import { parseCalendarDate } from "@/lib/format";
import { MAX_PROGRAM_WEEKS } from "@/lib/storage/types";

const MAX_SERVINGS = 100;
const MAX_GRAMS = 100_000;
const MAX_QUANTITY = 100_000;
const MAX_MACRO = 1_000_000;
const MAX_PRICE_IDR = 1_000_000_000;
const { ingredientIds, menuRecipeIds } = nutritionCatalog;
const macroKeys = ["energy_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"] as const;

function bad(detail: string): never {
  throw new HttpError(400, `Invalid plan: ${detail}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, max = 200): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

/** Checks the plan bounds needed before any week/date arithmetic is attempted. */
export function validatePlanSchedule(raw: unknown, week: number): void {
  if (!record(raw)) bad("the plan is not an object.");
  if (!Number.isInteger(raw.weekCount) || (raw.weekCount as number) < 1 ||
      (raw.weekCount as number) > MAX_PROGRAM_WEEKS) bad("week count is invalid.");
  if (!Number.isInteger(week) || week < 1 || week > (raw.weekCount as number)) {
    bad("requested week is outside the program.");
  }
  if (typeof raw.programStartDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(raw.programStartDate)) {
    bad("program start date is malformed.");
  }
  if (!parseCalendarDate(raw.programStartDate)) bad("program start date is invalid.");
}

function positive(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max;
}

function validateFiniteNumbers(value: unknown, seen = new Set<object>()): void {
  if (typeof value === "number" && !Number.isFinite(value)) bad("all numbers must be finite.");
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) validateFiniteNumbers(child, seen);
}

function validateMacros(value: unknown, label: string): void {
  if (!record(value)) bad(`${label} macros are missing.`);
  for (const key of macroKeys) {
    const amount = value[key];
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > MAX_MACRO) {
      bad(`${label} has an invalid ${key}.`);
    }
  }
}

function validateItem(value: unknown, label: string): asserts value is DishItem {
  if (!record(value)) bad(`${label} is malformed.`);
  if (!boundedString(value.ingredientId) || !ingredientIds.has(value.ingredientId)) {
    bad(`${label} refers to an unknown ingredient.`);
  }
  if (!boundedString(value.name, 300) || !boundedString(value.unitId, 100)) bad(`${label} is malformed.`);
  if (!positive(value.grams, MAX_GRAMS)) bad(`${label} grams must be positive and bounded.`);
  if (!positive(value.quantity, MAX_QUANTITY)) bad(`${label} quantity must be positive and bounded.`);
}

/** Validates the untrusted Firestore plan before any planner/order calculations run. */
export function validatePlanForOrder(raw: unknown, week: number, dishes: Map<string, Dish>): asserts raw is Plan {
  validateFiniteNumbers(raw);
  validatePlanSchedule(raw, week);
  if (!record(raw)) bad("the plan is not an object.");
  if (!boundedString(raw.id) || !boundedString(raw.ownerUid) || !boundedString(raw.title, 500)) bad("plan identity is malformed.");
  if (!Array.isArray(raw.mealSlots) || raw.mealSlots.length < 1 || raw.mealSlots.length > 20 ||
      raw.mealSlots.some((slot) => !boundedString(slot, 100)) || new Set(raw.mealSlots).size !== raw.mealSlots.length) {
    bad("meal slots are malformed.");
  }
  if (!Array.isArray(raw.assignments) || raw.assignments.length > 2_000) bad("assignments are malformed.");
  if (!(["draft", "submitted", "locked"] as unknown[]).includes(raw.status)) bad("status is malformed.");
  if (!Array.isArray(raw.submittedWeeks) || raw.submittedWeeks.some((submitted) =>
    !Number.isInteger(submitted) || submitted < 1 || submitted > (raw.weekCount as number))) {
    bad("submitted weeks are malformed.");
  }

  const assignmentIds = new Set<string>();
  for (const [index, assignment] of raw.assignments.entries()) {
    const label = `assignment ${index + 1}`;
    if (!record(assignment) || !boundedString(assignment.id)) bad(`${label} identity is malformed.`);
    if (assignmentIds.has(assignment.id)) bad(`${label} identity is duplicated.`);
    assignmentIds.add(assignment.id);
    if (!Number.isInteger(assignment.week) || (assignment.week as number) < 1 || (assignment.week as number) > (raw.weekCount as number)) bad(`${label} week is invalid.`);
    if (!Number.isInteger(assignment.day) || (assignment.day as number) < 0 || (assignment.day as number) > 6) bad(`${label} day is invalid.`);
    if (!boundedString(assignment.slot, 100) || !raw.mealSlots.includes(assignment.slot)) bad(`${label} slot is invalid.`);
    if (!positive(assignment.servings, MAX_SERVINGS)) bad(`${label} servings must be positive and bounded.`);
    if (assignment.menuRecipeId !== undefined &&
        (!boundedString(assignment.menuRecipeId) || !menuRecipeIds.has(assignment.menuRecipeId))) bad(`${label} refers to an unknown menu recipe.`);
    if (assignment.dishId !== undefined && !boundedString(assignment.dishId)) bad(`${label} dish identity is malformed.`);
    if (!record(assignment.snapshot) || !boundedString(assignment.snapshot.name, 500)) bad(`${label} snapshot is malformed.`);
    validateMacros(assignment.snapshot.totals, `${label} snapshot`);
    if (assignment.items !== undefined && !Array.isArray(assignment.items)) bad(`${label} items are malformed.`);
    const items = Array.isArray(assignment.items) ? assignment.items : undefined;
    items?.forEach((item, itemIndex) => validateItem(item, `${label} item ${itemIndex + 1}`));

    const liveDish = typeof assignment.dishId === "string" ? dishes.get(assignment.dishId) : undefined;
    if (liveDish) {
      if (!Array.isArray(liveDish.items)) bad(`${label} dish items are malformed.`);
      liveDish.items.forEach((item, itemIndex) => validateItem(item, `${label} dish item ${itemIndex + 1}`));
      validateMacros(liveDish.totals, `${label} dish`);
    }
    if ((!items || items.length === 0) && (!liveDish || liveDish.items.length === 0) && !assignment.menuRecipeId) {
      bad(`${label} has no meal items or authoritative menu identity.`);
    }
    if (assignment.price !== undefined) {
      if (!record(assignment.price) || assignment.price.complete !== true ||
          typeof assignment.price.totalIdr !== "number" || assignment.price.totalIdr < 0 || assignment.price.totalIdr > MAX_PRICE_IDR) {
        bad(`${label} price is incomplete or invalid.`);
      }
    }
    const price = assignmentPrice(assignment as never, dishes);
    if (!price.complete || !Number.isFinite(price.totalIdr) || price.totalIdr < 0 || price.totalIdr > MAX_PRICE_IDR) bad(`${label} price is incomplete or invalid.`);
  }
}

/** Final invariant check: no invalid derived value may reach a Firestore write. */
export function validateOrderDays(days: OrderDay[]): void {
  for (const day of days) for (const meal of day.meals) {
    validateMacros(meal.totals, `derived meal ${meal.assignmentId}`);
    if (!Number.isFinite(meal.priceIdr) || meal.priceIdr < 0 || meal.priceIdr > MAX_PRICE_IDR) bad("derived meal price is invalid.");
  }
}
