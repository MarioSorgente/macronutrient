import type { PlannerCandidate } from "@/types/nutrition";

/**
 * Weekly variety accounting.
 *
 * Repetition is measured on normalized metadata, so a Negrita menu dish, a
 * saved dish and a plate the planner composed itself all count the same way —
 * three chicken meals are three chicken meals whatever produced them.
 *
 * Two things the previous, linear version got wrong and this one does not:
 *
 *  - Penalties escalate. Seeing a dish twice in a week is normal; seeing it
 *    seven times is not, and a flat per-use cost never makes the seventh
 *    materially worse than the second.
 *  - Repetition is counted per slot as well as per week. "Chicken again for
 *    dinner" is ordinary; "the same breakfast every single morning" is the
 *    complaint, and only a slot-aware counter can tell those apart.
 */

/** Penalties per repeat, anywhere in the week. */
export const GLOBAL_REPEAT_PENALTY = {
  exactDishIdentity: 1.1,
  proteinFamily: 0.3,
  dishStyle: 0.28,
  carbFamily: 0.22,
  cuisineFamily: 0.18,
  sauceFamilies: 0.15,
  mealArchetype: 0.12,
} as const;

/**
 * Penalties per repeat in the *same* slot, which is what reads as robotic.
 *
 * `dishStyle` sits just under the exact dish on purpose. Swapping one oatmeal
 * bowl for the other oatmeal bowl satisfies an exact-dish counter and changes
 * nothing about the week, and the same is true of a third savoury egg plate
 * under a different template. Style has to cost nearly as much as the dish
 * itself or "rotate the styles" is not something the optimizer can be asked for.
 */
export const SLOT_REPEAT_PENALTY = {
  exactDishIdentity: 1.6,
  dishStyle: 1.3,
  proteinFamily: 0.5,
  carbFamily: 0.3,
  mealArchetype: 0.25,
} as const;

/** Penalties for repeating a whole day, exactly or in shape. */
export const DAY_REPEAT_PENALTY = {
  exact: 6,
  family: 2.4,
  /** Two days whose lunch and dinner are the same pair, in either order. */
  mainsSwapped: 1.4,
} as const;

export type VarietyDimension = keyof typeof GLOBAL_REPEAT_PENALTY;

/**
 * Cost multiplier by number of previous uses. The jump from the second to the
 * third use is what stops a dish settling in as the default.
 */
const ESCALATION = [0, 1, 3, 6, 10] as const;

export function escalatingMultiplier(previousUses: number): number {
  return ESCALATION[Math.min(Math.max(previousUses, 0), ESCALATION.length - 1)];
}

/** Repeating something the very next day is the most conspicuous repetition. */
export const CONSECUTIVE_MULTIPLIER = 2.5;

/**
 * Meat-led breakfasts recur worse than they read. A chicken breakfast is a
 * legitimate menu item and stays eligible; this only makes it expensive as a
 * daily habit, which is what turned one burrito into seven.
 */
export const HEAVY_BREAKFAST_FAMILIES: ReadonlySet<string> =
  new Set(["chicken", "beef", "pork"]);
export const HEAVY_BREAKFAST_MULTIPLIER = 1.9;

/**
 * Breakfast is the slot people notice repeating, and the one with the fewest
 * genuinely different options — so style repetition there is charged harder
 * than anywhere else. This is what keeps any single breakfast from becoming the
 * default once the previous one has been penalised out of the way.
 */
export const BREAKFAST_STYLE_MULTIPLIER = 1.6;

/**
 * Asking for "more fish" should tolerate seeing fish more often, otherwise the
 * repeat penalty cancels the lean after a single use — which matters here
 * because the DIY menu has only two fish items big enough to anchor a meal.
 */
export const LEAN_REPEAT_RELIEF = 0.4;

export interface RepeatKey {
  key: string;
  weight: number;
}

/**
 * A composed meal's identity includes its portions, which is right for pricing
 * and wrong for variety: 150 g and 175 g of the same teriyaki chicken on the
 * same sourdough is the same dinner twice. Shape strips the grams.
 */
export function dishShapeIdentity(candidate: PlannerCandidate): string {
  if (candidate.source !== "generated_diy") return candidate.exactDishIdentity;
  const parts = candidate.breakdown.map((item) => item.ingredientId).sort();
  return `shape:${candidate.mealArchetype}:${parts.join("+")}`;
}

export function familySignatureOf(candidate: PlannerCandidate): string {
  return [candidate.dishStyle, candidate.proteinFamily, candidate.carbFamily,
    candidate.cuisineFamily].join("/");
}

export function repetitionCost(
  keys: readonly RepeatKey[],
  counts: ReadonlyMap<string, number>,
  previousDay: ReadonlySet<string>
): number {
  let cost = 0;
  for (const entry of keys) {
    cost += entry.weight * escalatingMultiplier(counts.get(entry.key) ?? 0);
    if (previousDay.has(entry.key)) cost += entry.weight * CONSECUTIVE_MULTIPLIER;
  }
  return cost;
}

export function applyRepetition(
  counts: Map<string, number>,
  keys: readonly RepeatKey[]
): void {
  for (const entry of keys) {
    counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);
  }
}

// --- public per-dimension counters -------------------------------------------

/**
 * Source-independent counters, kept as a plain record of maps because they are
 * also read directly — by the planner preview and by tests asserting that a
 * menu dish and a composed plate land in the same family bucket.
 */
export type WeeklyVarietyUsage = Record<VarietyDimension, Map<string, number>> & {
  /** Slot-qualified counters, keyed `${slot}|${dimension}|${value}`. */
  bySlot: Map<string, number>;
  /** Whole-day signatures, exact and family-level. */
  daySignatures: Map<string, number>;
};

const DIMENSIONS = Object.keys(GLOBAL_REPEAT_PENALTY) as VarietyDimension[];

export function createWeeklyVarietyUsage(): WeeklyVarietyUsage {
  return {
    exactDishIdentity: new Map(), proteinFamily: new Map(), dishStyle: new Map(),
    carbFamily: new Map(), cuisineFamily: new Map(), sauceFamilies: new Map(),
    mealArchetype: new Map(), bySlot: new Map(), daySignatures: new Map(),
  };
}

export function varietyValues(
  candidate: PlannerCandidate,
  dimension: VarietyDimension
): string[] {
  const value = candidate[dimension];
  return Array.isArray(value) ? value : [value];
}

export function recordWeeklyVariety(
  usage: WeeklyVarietyUsage,
  candidate: PlannerCandidate,
  slot?: string
): void {
  for (const dimension of DIMENSIONS) {
    for (const value of varietyValues(candidate, dimension)) {
      usage[dimension].set(value, (usage[dimension].get(value) ?? 0) + 1);
      if (slot) {
        const key = `${slot}|${dimension}|${value}`;
        usage.bySlot.set(key, (usage.bySlot.get(key) ?? 0) + 1);
      }
    }
  }
}

export function recordDaySignature(usage: WeeklyVarietyUsage, signature: string): void {
  usage.daySignatures.set(signature, (usage.daySignatures.get(signature) ?? 0) + 1);
}
