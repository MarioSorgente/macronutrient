import type { ClientPreferences } from "@/lib/storage/types";
import type { GenerateOptions, GeneratedMeal, GeneratedPlan } from "@/lib/mealPlanner";

export const SHUFFLE_SEARCH_MS = 4_800;
export const SHUFFLE_MAX_CANDIDATES = 24;

export type PlannerGenerator = (options: GenerateOptions) => GeneratedPlan;

export interface ShuffleSearchOptions {
  current: GeneratedPlan;
  generation: GenerateOptions;
  firstSeed: number;
  generate: PlannerGenerator;
  signal?: AbortSignal;
  maxDurationMs?: number;
  maxCandidates?: number;
  now?: () => number;
  yieldToBrowser?: () => Promise<void>;
}

export interface ShuffleSearchResult {
  plan: GeneratedPlan;
  seed: number;
  changed: boolean;
  evaluated: number;
}

/** Portion sizes deliberately do not participate in a meal's identity. */
export function normalizedMealIdentity(meal: GeneratedMeal): string {
  if (meal.sourceDishId) return `dish:${meal.sourceDishId}`;
  return `meal:${meal.items.map((item) => item.ingredientId).sort().join("+")}`;
}

export function normalizedWeekIdentities(plan: GeneratedPlan): string[] {
  return plan.days.flatMap((day) => day.meals.map(normalizedMealIdentity));
}

export function meaningfulDifference(a: GeneratedPlan, b: GeneratedPlan): number {
  const left = normalizedWeekIdentities(a);
  const right = normalizedWeekIdentities(b);
  const length = Math.max(left.length, right.length);
  let changed = 0;
  for (let i = 0; i < length; i += 1) if (left[i] !== right[i]) changed += 1;
  return changed;
}

function varietyScore(plan: GeneratedPlan): number {
  const identities = normalizedWeekIdentities(plan);
  const styles = plan.days.flatMap((day) => day.meals.map((meal) => `${meal.slot}:${meal.dishStyle}`));
  return new Set(identities).size * 2 + new Set(styles).size;
}

function preferenceFit(plan: GeneratedPlan, preferences?: ClientPreferences): number {
  if (!preferences?.proteinLean.length) return 0;
  const needles = preferences.proteinLean.map((value) => value.toLowerCase());
  return plan.days.flatMap((day) => day.meals).filter((meal) => {
    const text = `${meal.name} ${meal.items.map((item) => `${item.ingredientId} ${item.name}`).join(" ")}`.toLowerCase();
    return needles.some((needle) => text.includes(needle));
  }).length;
}

function totalPrice(plan: GeneratedPlan): number {
  return plan.days.reduce((sum, day) => sum + day.price.totalIdr, 0);
}

/** Defensive validation: generated candidates may only compete if every hard invariant is retained. */
export function equivalentWeek(current: GeneratedPlan, candidate: GeneratedPlan, options: GenerateOptions): boolean {
  if (candidate.days.length !== current.days.length) return false;
  const currentClasses = new Map(current.days.map((day) => [day.day, day.adherence.classification]));
  const avoided = new Set(options.preferences?.avoidIngredientIds ?? []);
  return candidate.days.every((day) =>
    currentClasses.get(day.day) === day.adherence.classification &&
    (options.dailyBudgetIdr == null || day.price.totalIdr <= options.dailyBudgetIdr) &&
    day.meals.every((meal) =>
      options.slots.includes(meal.slot) && meal.items.every((item) => !avoided.has(item.ingredientId)))
  );
}

/**
 * Deterministic, bounded, cooperative search. The clock and yield are injectable,
 * so correctness tests never depend on machine speed; production leaves 1.2 s
 * below the six-second interaction budget.
 */
export async function searchShuffleAlternatives(options: ShuffleSearchOptions): Promise<ShuffleSearchResult> {
  const now = options.now ?? (() => performance.now());
  const yieldToBrowser = options.yieldToBrowser ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const started = now();
  let best: { plan: GeneratedPlan; seed: number; rank: number[] } | null = null;
  let evaluated = 0;

  for (let offset = 0; offset < (options.maxCandidates ?? SHUFFLE_MAX_CANDIDATES); offset += 1) {
    if (options.signal?.aborted || now() - started >= (options.maxDurationMs ?? SHUFFLE_SEARCH_MS)) break;
    await yieldToBrowser();
    if (options.signal?.aborted) break;
    const seed = options.firstSeed + offset;
    const candidate = options.generate({ ...options.generation, seed });
    evaluated += 1;
    const difference = meaningfulDifference(options.current, candidate);
    if (!difference || !equivalentWeek(options.current, candidate, options.generation)) continue;
    const rank = [difference, varietyScore(candidate), preferenceFit(candidate, options.generation.preferences),
      -totalPrice(candidate), -seed];
    if (!best || rank.some((value, index) => value !== best!.rank[index] &&
      rank.slice(0, index).every((prior, priorIndex) => prior === best!.rank[priorIndex]) && value > best!.rank[index])) {
      best = { plan: candidate, seed, rank };
    }
  }

  return best ? { plan: best.plan, seed: best.seed, changed: true, evaluated }
    : { plan: options.current, seed: options.firstSeed - 1, changed: false, evaluated };
}
