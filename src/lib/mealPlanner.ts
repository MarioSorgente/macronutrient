import type { Macros, PlannerCandidate } from "@/types/nutrition";
import { GRAM_UNIT_ID } from "@/types/nutrition";
import { getIngredient, getRecipe } from "@/lib/database";
import { EMPTY_MACROS, perItemMacros } from "@/lib/calc";
import { ZERO_PRICE, addPrices, priceItems, type PriceResult } from "@/lib/pricing";
import { TARGET_FIELDS, adherencePct } from "@/lib/clients";
import {
  DAILY_MACRO_KEYS,
  dailyTolerance,
  diagnoseDailyAdherence,
  type DailyAdherenceDiagnostics,
  type DailyMacroKey,
  type MacroAdherenceDiagnostic,
} from "@/lib/dailyAdherence";
import { remainingTarget, scoreAgainst } from "@/lib/macroFit";
import { resolveTarget, validateMacroTarget, type DerivationStyle, type TargetMode } from "@/lib/targetResolution";
import { candidateIsLeaned, readyPlannerCatalog } from "@/lib/plannerCandidates";
import { composeCandidatesForResidual } from "@/lib/plannerComposer";
import {
  BREAKFAST_STYLE_MULTIPLIER,
  DAY_REPEAT_PENALTY,
  GLOBAL_REPEAT_PENALTY,
  HEAVY_BREAKFAST_FAMILIES,
  HEAVY_BREAKFAST_MULTIPLIER,
  LEAN_REPEAT_RELIEF,
  SLOT_REPEAT_PENALTY,
  applyRepetition,
  createWeeklyVarietyUsage,
  dishShapeIdentity,
  escalatingMultiplier,
  familySignatureOf,
  recordDaySignature,
  recordWeeklyVariety,
  repetitionCost,
  varietyValues,
  type RepeatKey,
  type VarietyDimension,
  type WeeklyVarietyUsage,
} from "@/lib/plannerVariety";
import {
  mealSlotPenalty,
  mealSlotEligibility,
  namedDishSlotPenalty,
  optionalSlots,
  sectionSlotPenalty,
  slotKindOf,
} from "@/lib/slotSuitability";
import {
  DEFAULT_PREFERENCES,
  type ClientPreferences,
  type Dish,
  type DishItem,
  type MacroTargets,
  type MacroStyle,
} from "@/lib/storage/types";

/**
 * Auto-planner: given daily macro targets, assemble meals that hit them from
 * what Negrita actually sells.
 *
 * Two candidate sources, as required:
 *  - COMPOSED  — built from DIY components against the macros the day still
 *                has left, which is what the kitchen can assemble to order.
 *  - READY     — menu dishes and the user's own saved dishes, used whole, on
 *                their published macros.
 *
 * Three passes, in strict priority order:
 *
 *  1. A whole-day beam search produces complete days. Pruning is feasibility
 *     aware: a partial day is judged by whether the slots still to come can
 *     close the remaining macros, never by how close the half-eaten day already
 *     looks. Price takes no part in it.
 *  2. The best adherence class is taken, and a diverse pool of days inside that
 *     class is kept rather than collapsing immediately to one winner.
 *  3. A second beam picks one day per weekday from that pool, minimising
 *     weekly repetition. Every day in the pool already meets the same macro
 *     standard, so variety decides between them and can never demote adherence.
 */

export interface GeneratedMeal {
  slot: string;
  name: string;
  items: DishItem[];
  macros: Macros;
  price: PriceResult;
  /** Set when the meal is an existing saved dish or menu recipe. */
  sourceDishId?: string;
  /**
   * Set when the meal is a Negrita menu dish. Carried out of the planner so the
   * saved plan can keep the identity rather than a copy of it: the menu's price
   * and published macros are what this meal was chosen on, and re-deriving
   * either from the ingredient list gives a different meal.
   */
  menuRecipeId?: string;
  kind: "composed" | "ready";
  /** Normalized culinary style, carried through so callers can group by it. */
  dishStyle: string;
}

export interface GeneratedDay {
  day: number;
  meals: GeneratedMeal[];
  macros: Macros;
  price: PriceResult;
  /**
   * Slots the planner could not fill within the constraints. Surfaced rather
   * than silently padded, so you know the budget (not the menu) is what
   * kept the day short.
   */
  unfilledSlots: string[];
  /**
   * Optional slots the day deliberately went without, because it reaches its
   * macros without them. Distinct from `unfilledSlots`: nothing was missing.
   */
  skippedSlots: string[];
  /** Adherence is assessed once, from the complete day's totals. */
  adherence: DailyAdherenceDiagnostics;
}

/**
 * A generated week together with the target it was actually generated against,
 * so applying the plan can persist that target rather than leaving the saved
 * plan disagreeing with the preview it was accepted from.
 */
export interface GeneratedPlan {
  days: GeneratedDay[];
  resolvedTarget: MacroTargets;
  targetSource: "explicit" | "derived";
  targetStyle: TargetMode;
  targetExplanation: string;
}

export type { DailyAdherenceDiagnostics, MacroAdherenceDiagnostic };
export type { WeeklyVarietyUsage };
export { createWeeklyVarietyUsage, recordWeeklyVariety, scoreAgainst };

export interface GenerateOptions {
  /** Optional explicit target; otherwise derive one from `targetStyle`. */
  targets?: MacroTargets | null;
  targetStyle?: DerivationStyle | MacroStyle;
  slots: string[];
  /** Use the 25 Negrita menu dishes as whole-meal options. */
  includeMenuDishes: boolean;
  /** Use the user's own saved and custom dishes as whole-meal options. */
  includeSavedDishes: boolean;
  /** Use meals assembled from kitchen components (defaults to true). */
  includeComposed?: boolean;
  /** Saved dishes available as ready meals. */
  savedDishes: Dish[];
  /** Tastes. Leans bias the mix; the avoid list is absolute. */
  preferences?: ClientPreferences;
  /** Optional ceiling on a single day's food cost, in rupiah. */
  dailyBudgetIdr?: number | null;
  /** Days to generate (0 = Monday). */
  days: number[];
  /** Deterministic output when set, for testing. */
  seed?: number;
  /**
   * Small, caller-supplied catalog used by deterministic planner simulations.
   * Candidates still pass through the normal slot, preference, budget, search,
   * and adherence pipeline; this merely avoids coupling bounded tests to the
   * restaurant catalog.
   */
  candidateFixtures?: PlannerCandidate[];
}

// --- tuning ------------------------------------------------------------------

/**
 * Complete days closer than this are operationally equivalent. The error is
 * already normalized by each macro's daily tolerance, so 0.1 is only one tenth
 * of a tolerance unit on the four-macro average.
 */
export const COMPLETE_DAY_ERROR_EQUIVALENCE = 0.1;

/**
 * The same, for a week where nothing can comply.
 *
 * When a compliant day exists, a tenth of a tolerance unit is a real difference
 * and the tighter window applies. When the target is simply beyond what the
 * menu can assemble, every candidate day fails the same way and the gap between
 * them is a fraction of a shortfall none of them closes — at 4,000 kcal here
 * the best day is 250 kcal short, and refusing to rotate breakfast because one
 * option is 30 kcal shorter still buys nothing and costs the week its variety.
 *
 * Wide enough to hold the near-misses together (a 1,095 kcal pancake and a
 * 1,085 kcal oatmeal bowl), narrow enough to leave out the breakfasts that are
 * not in the running at all — those sit five to nine tolerance units back.
 */
export const UNREACHABLE_DAY_ERROR_EQUIVALENCE = 0.75;

/** Partial days retained at each depth, and how many go on macro fit alone. */
const BEAM_WIDTH = 220;
const BEAM_MACRO_CORE = 96;
/**
 * The same, for a search whose slot is already decided.
 *
 * A locked search starts from a handful of fixed choices rather than the whole
 * catalog, so it is solving a much smaller problem and does not need the width
 * the open search does. It is not free to narrow, though: at 96 the pancake
 * days these searches exist to find stopped surviving to the end, so the width
 * is set by what still finds them rather than by what is cheapest.
 */
const LOCKED_BEAM_WIDTH = 160;
const LOCKED_BEAM_MACRO_CORE = 72;
/** Complete days carried into the weekly pass, and how many go on fit alone. */
const DAY_POOL_SIZE = 48;
const DAY_POOL_CORE = 8;
/**
 * Places in the pool reserved for the cheapest compliant days. Price never
 * reaches the search — every day here already holds the best adherence class —
 * but without this the weekly pass can be handed forty equally varied days that
 * all happen to be expensive, and cost has nothing to choose between.
 */
const DAY_POOL_AFFORDABLE_SLICE = 6;
/**
 * Places reserved for the days that best match the protein lean. Preferences
 * rank above price and below adherence, and like price they need candidates to
 * act on: a pool chosen purely for macro coverage can contain forty days that
 * all happen to ignore "more fish", leaving the lean bonus nothing to prefer.
 */
const DAY_POOL_PREFERENCE_SLICE = 8;
/**
 * Places reserved for days that exist only because a choice was locked in and
 * the day solved around it.
 *
 * They need reserving for the same reason price and preference do, and more
 * urgently: a pancake day is the *only* day its breakfast will ever appear in,
 * it ranks below the composed days that were built to fit the residual, and
 * with fifty distinct breakfasts in play the coverage pass has room for a dozen
 * of them. Proving the day exists and then dropping it before the weekly pass
 * ever sees it is the whole bug.
 */
const DAY_POOL_ANCHOR_SLICE = 10;
/** Weekly assignments retained at each day. */
const WEEK_BEAM_WIDTH = 96;
const WEEK_BEAM_CORE = 64;
/**
 * Weekly plans within this much cost per day of the best are equally
 * acceptable. Every day in every one of them holds the same adherence
 * classification — the pool was filtered to one class before the weekly pass
 * began — so the only thing separating them is a fraction of one repeat.
 * Shuffle picks between these; it cannot reach past them, and it can never
 * change what a day is classified as.
 */
const WEEK_COST_EQUIVALENCE_PER_DAY = 0.35;
/**
 * Shuffle always gets something to choose between. When the search converges so
 * hard that only one week falls inside the equivalence window, the next few
 * cheapest weeks are admitted anyway: they hold the same adherence class for
 * every day and differ by a fraction of one repeat, so nothing is given up, and
 * without them the Shuffle button silently does nothing.
 */
const MIN_WEEK_FINALISTS = 6;

/** Distinct residuals a slot composes for. Beyond this, the nearest is reused. */
const MAX_RESIDUAL_BUCKETS_PER_SLOT = 10;
const COMPOSED_CANDIDATES_PER_RESIDUAL = 72;

/**
 * How strongly a leaned-toward protein is favoured. A bonus, never a filter:
 * "more fish" should tilt the week toward fish, not make everything else
 * ineligible and leave slots the planner cannot fill.
 */
const LEAN_BONUS = 0.8;

/**
 * Price is a tie-breaker between meals that are already equally good on macros,
 * and nothing more. It is deliberately absent from candidate generation and
 * from beam pruning: a cheaper path must never survive at the expense of one
 * that could still have closed the day exactly. A hard budget, when set, is
 * enforced as a constraint instead.
 */
const PRICE_TIEBREAK_WEIGHT = 0.4;
const PRICE_REFERENCE_IDR = 200000;

/**
 * How much residual macro error counts once every candidate day is already
 * inside tolerance. Small on purpose: it settles ties between equally varied
 * days without letting a tenth of a tolerance unit reinstate the identical week.
 */
const ADHERENCE_TIEBREAK_WEIGHT = 0.25;

/** Repeating a family twice inside one day, before the week is considered. */
const SAME_DAY_PENALTY: Partial<Record<VarietyDimension, number>> = {
  dishStyle: 0.4, proteinFamily: 0.35, carbFamily: 0.25, cuisineFamily: 0.2,
  mealArchetype: 0.15,
};

function pricePenalty(priceIdr: number): number {
  return PRICE_TIEBREAK_WEIGHT * (priceIdr / PRICE_REFERENCE_IDR);
}

/** Prefix of a planner candidate id built from a Negrita menu recipe. */
const MENU_CANDIDATE_PREFIX = "menu:";

/** Identifies the pick that stands for "this optional slot was left out". */
const SKIPPED_MEAL_PREFIX = "skipped:";

/**
 * Share of the day a slot should carry. A snack or pre-workout is not a third
 * of someone's intake, and without this the planner cheerfully composes a
 * 100 g steak as a "snack".
 */
function slotWeight(slot: string): number {
  const name = slot.toLowerCase();
  if (/snack|pre-?workout|post-?workout|shake/.test(name)) return 0.55;
  return 1;
}

// --- deterministic RNG -------------------------------------------------------

/**
 * Which of a set of equivalent solutions a seed selects.
 *
 * Counted from the best one: seed 1 — the default, and what every first
 * generation uses — is the best answer the search found, and each Shuffle from
 * there steps to the next. Stepping rather than hashing because a minimum over
 * hashed keys is an independent coin toss per seed, so two consecutive presses
 * landed on the same week about one time in six, the button visibly doing
 * nothing.
 *
 * The 1-based offset is not cosmetic. `ranked.slice(0, MIN_WEEK_FINALISTS)`
 * admits a few near-equivalents so Shuffle has somewhere to go even when the
 * search converges hard, and those are *near*, not equal — indexing from zero
 * meant the default seed handed back the runner-up, which is how a day whose
 * target was one menu dish's macros exactly came back as a composed plate
 * costing two and a half times as much.
 */
function seededChoice<T>(seed: number, equivalents: readonly T[]): T {
  const count = equivalents.length;
  const step = Math.trunc(seed) - 1;
  return equivalents[((step % count) + count) % count];
}

// --- candidates --------------------------------------------------------------

interface Candidate extends PlannerCandidate {
  /** Output aliases retained at the planner boundary. */
  name: string;
  items: DishItem[];
  macros: Macros;
  priceIdr: number;
  slotPenalty: number;
  /** Whether this meal's protein is one the plan leans toward. */
  leaned: boolean;
  kind: "composed" | "ready";
  sourceDishId?: string;
  menuRecipeId?: string;
  /** Portion-independent identity, used for repetition. */
  dishShape: string;
  familySignature: string;
}

function toCandidate(
  normalized: PlannerCandidate,
  preferences: ClientPreferences,
  kind: "composed" | "ready",
  slotPenalty: number,
  sourceDishId?: string
): Candidate {
  // Where a ready meal came from, kept as an id rather than as a copy of its
  // price and macros — those are facts about the menu, and the menu owns them.
  const menuRecipeId = normalized.source === "negrita_menu"
    ? normalized.id.slice(MENU_CANDIDATE_PREFIX.length) : undefined;
  const items: DishItem[] = normalized.breakdown.map((item) => ({
    ingredientId: item.ingredientId, name: item.name, grams: item.grams,
    unitId: GRAM_UNIT_ID, quantity: item.grams,
  }));
  return {
    ...normalized,
    name: normalized.displayName,
    items,
    macros: normalized.optimizerMacros,
    priceIdr: normalized.price.totalIdr,
    slotPenalty,
    // Determined from the normalized protein family for every source, so a
    // "more fish" lean reaches a salmon menu dish exactly as it reaches a
    // salmon plate the planner composed itself.
    leaned: candidateIsLeaned(normalized.proteinFamily, preferences.proteinLean),
    kind,
    sourceDishId,
    ...(menuRecipeId ? { menuRecipeId } : {}),
    dishShape: dishShapeIdentity(normalized),
    familySignature: familySignatureOf(normalized),
  };
}

/**
 * "No snack", as something the search can pick.
 *
 * The target belongs to the whole day, not to a fixed number of meals: a day
 * that reaches its macros in three is finished. Modelling that as a zero-macro
 * candidate rather than as a nullable pick keeps every pick aligned with its
 * slot, so repetition accounting, the pool's per-slot caps and materialisation
 * all keep working unchanged — and it costs nothing, so the beam only keeps it
 * when the day adheres better without the meal.
 */
function skippedCandidate(slot: string): Candidate {
  const identity = `${SKIPPED_MEAL_PREFIX}${slot}`;
  return {
    id: identity,
    source: "generated_diy",
    displayName: `No ${slot}`,
    name: `No ${slot}`,
    optimizerMacros: { ...EMPTY_MACROS },
    macros: { ...EMPTY_MACROS },
    breakdown: [],
    items: [],
    price: { totalIdr: 0, complete: true },
    priceIdr: 0,
    // An absent meal has no protein, no carb and no cuisine. It carries only its
    // own identity, so it repeats nothing but itself.
    proteinFamily: "other",
    carbFamily: "other",
    cuisineFamily: identity,
    mealArchetype: identity,
    dishStyle: identity,
    eligibleMealTypes: [],
    macroConfidence: "published",
    readyMadePriority: "normal",
    modificationOptions: [],
    dietaryTags: [],
    allergenTags: [],
    sauceFamilies: [],
    exactDishIdentity: identity,
    slotPenalty: 0,
    leaned: false,
    kind: "ready",
    dishShape: identity,
    familySignature: identity,
  };
}

function isSkipped(candidate: { id: string }): boolean {
  return candidate.id.startsWith(SKIPPED_MEAL_PREFIX);
}

function menuRecipesSection(recipeId: string): string | null {
  return getRecipe(recipeId)?.section ?? null;
}

/** Menu recipes and saved dishes, offered whole on their published macros. */
function readyCandidates(
  slot: string,
  savedDishes: Dish[],
  menuDishes: boolean,
  budgetIdr: number | null,
  preferences: ClientPreferences,
  fixtures: PlannerCandidate[] = []
): Candidate[] {
  const out: Candidate[] = [];
  const avoid = preferences.avoidIngredientIds;

  for (const normalized of [...readyPlannerCatalog(savedDishes, menuDishes), ...fixtures]) {
    const eligibility = mealSlotEligibility({ slot, name: normalized.displayName,
      mealArchetype: normalized.mealArchetype,
      eligibleMealTypes: normalized.eligibleMealTypes,
      ingredients: normalized.breakdown });
    if (!eligibility.allowed) continue;
    if (normalized.breakdown.some((item) => avoid.includes(item.ingredientId))) continue;
    const price = normalized.price;
    // An incompletely priced dish has an unknown true cost, so it cannot be
    // shown to fit a budget. Treating its partial total as the real price let a
    // Rp 40,000 "minimum" smuggle a 1,218 kcal dish into a snack slot.
    if (budgetIdr !== null && (!price.complete || price.totalIdr > budgetIdr)) continue;
    const recipeSection = normalized.source === "negrita_menu"
      ? menuRecipesSection(normalized.id.slice(MENU_CANDIDATE_PREFIX.length)) : null;
    const slotPenalty = recipeSection
      ? sectionSlotPenalty(recipeSection, slot) ?? namedDishSlotPenalty(normalized.displayName, slot)
      : namedDishSlotPenalty(normalized.displayName, slot);
    out.push(toCandidate(normalized, preferences, "ready", slotPenalty,
      normalized.source === "saved_dish" ? normalized.id.slice("saved:".length) : undefined));
  }

  return out;
}

function composedCandidates(
  slot: string,
  residual: MacroTargets,
  slotsRemaining: number,
  slotShare: number,
  preferences: ClientPreferences,
  budgetRemainingIdr: number | null
): Candidate[] {
  return composeCandidatesForResidual({
    slot, residual, slotsRemaining, slotShare, preferences, budgetRemainingIdr,
    maxCandidates: COMPOSED_CANDIDATES_PER_RESIDUAL,
  }).map((normalized) => {
    const eligibility = mealSlotEligibility({ slot, name: normalized.displayName,
      mealArchetype: normalized.mealArchetype,
      eligibleMealTypes: normalized.eligibleMealTypes,
      ingredients: normalized.breakdown });
    if (!eligibility.allowed) return null;
    return toCandidate(normalized, preferences, "composed",
      mealSlotPenalty(normalized.breakdown.map((item) => item.ingredientId), slot));
  }).filter((candidate): candidate is Candidate => candidate !== null);
}

// --- reachability ------------------------------------------------------------

export interface MacroRange {
  min: Record<DailyMacroKey, number>;
  max: Record<DailyMacroKey, number>;
}

function emptyRange(): MacroRange {
  return {
    min: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
    max: { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  };
}

function rangeOver(candidates: Candidate[]): MacroRange {
  if (!candidates.length) return emptyRange();
  const range: MacroRange = {
    min: { energy_kcal: Infinity, protein_g: Infinity, carbs_g: Infinity, fat_g: Infinity },
    max: { energy_kcal: -Infinity, protein_g: -Infinity, carbs_g: -Infinity, fat_g: -Infinity },
  };
  for (const candidate of candidates) {
    for (const key of DAILY_MACRO_KEYS) {
      const value = candidate.macros[key];
      if (value < range.min[key]) range.min[key] = value;
      if (value > range.max[key]) range.max[key] = value;
    }
  }
  return range;
}

function addRange(a: MacroRange, b: MacroRange): MacroRange {
  const out = emptyRange();
  for (const key of DAILY_MACRO_KEYS) {
    out.min[key] = a.min[key] + b.min[key];
    out.max[key] = a.max[key] + b.max[key];
  }
  return out;
}

/**
 * How a partial day is judged.
 *
 * `infeasibility` is what the remaining slots provably cannot cover, in
 * tolerance units. It is zero for every state that can still finish inside
 * tolerance, so a path that merely *looks* worse right now is never discarded
 * in favour of one that has already made the day impossible.
 *
 * `slack` breaks the remaining ties by how comfortably the residual sits inside
 * what is left to come — the middle of the reachable envelope is the easiest
 * place to finish from. With no slots left both collapse to the day's own
 * normalized error, so the last depth ranks by exactly the adherence measure
 * the day will be classified on.
 */
export function estimateCompletion(
  residual: MacroTargets,
  reachable: MacroRange,
  target: MacroTargets
): { infeasibility: number; slack: number } {
  let infeasibility = 0;
  let slack = 0;
  for (const key of DAILY_MACRO_KEYS) {
    const tolerance = Math.max(dailyTolerance(key, target[key]), 1e-6);
    const low = reachable.min[key];
    const high = reachable.max[key];
    const value = residual[key];
    if (value < low) infeasibility += (low - value) / tolerance;
    else if (value > high) infeasibility += (value - high) / tolerance;
    const half = (high - low) / 2;
    const middle = (high + low) / 2;
    slack += half > 0
      ? Math.min(Math.abs(value - middle) / half, 4)
      : Math.abs(value - middle) / tolerance;
  }
  return { infeasibility: infeasibility / DAILY_MACRO_KEYS.length,
    slack: slack / DAILY_MACRO_KEYS.length };
}

// --- whole-day search --------------------------------------------------------

interface SlotPlan {
  slot: string;
  /** Share of the remaining appetite this slot carries. */
  weight: number;
  /** Whether the day may be finished without this slot at all. */
  optional: boolean;
  ready: Candidate[];
  reach: MacroRange;
  composed: ComposedCache;
}

/**
 * Composed meals already built for one slot, by quantized residual.
 *
 * Scoped to a search rather than to the slot, because what a slot should
 * compose depends entirely on what the rest of the day has left — and a cache
 * shared between searches hands the second one meals built for the first one's
 * day. That is not a small inaccuracy: a search that locks a 1,095 kcal
 * breakfast in place needs lunches for the 900 kcal that remain, and reusing
 * the nearest bucket from an ordinary day is exactly how a provably compliant
 * pancake day came back as Best effort.
 */
interface ComposedCache {
  store: Map<string, { coords: number[]; candidates: Candidate[] }>;
  /** Distinct residuals this cache will compose for before reusing the nearest. */
  limit: number;
}

/**
 * A cache of its own, starting from what another search already built.
 *
 * Seeding matters as much as separating: two searches asking for the same
 * quantized residual want the same meals, and composing is where the time goes.
 * What a locked search must not do is inherit the *ceiling* as well — that is
 * how it ends up with nothing but meals built for a day it is not solving.
 */
function composedCache(
  limit = MAX_RESIDUAL_BUCKETS_PER_SLOT,
  seed?: ComposedCache
): ComposedCache {
  return { store: new Map(seed?.store), limit };
}

interface DayState {
  picks: Candidate[];
  macros: Macros;
  priceIdr: number;
  shapes: string[];
  leaned: number;
  infeasibility: number;
  slack: number;
  pathKey: string;
}

function addInto(macros: Macros, other: Macros): Macros {
  return {
    energy_kcal: macros.energy_kcal + other.energy_kcal,
    protein_g: macros.protein_g + other.protein_g,
    carbs_g: macros.carbs_g + other.carbs_g,
    fat_g: macros.fat_g + other.fat_g,
    fiber_g: macros.fiber_g + other.fiber_g,
  };
}

const BUCKET_STEP: Record<DailyMacroKey, number> = {
  energy_kcal: 125, protein_g: 15, carbs_g: 20, fat_g: 10,
};

function bucketCoords(residual: MacroTargets): number[] {
  return DAILY_MACRO_KEYS.map((key) => Math.round(residual[key] / BUCKET_STEP[key]));
}

/**
 * Composed candidates are a function of the residual, so they are rebuilt as
 * the day is assembled rather than once per slot up front. Residuals are
 * quantized first: two states 20 kcal apart want the same dinner, and composing
 * separately for each of them would multiply the work for nothing. Past the
 * bucket ceiling the nearest already-composed residual is reused, which keeps
 * generation bounded however wide the beam gets.
 */
function composedFor(
  plan: SlotPlan,
  cache: ComposedCache,
  residual: MacroTargets,
  slotsRemaining: number,
  slotShare: number,
  preferences: ClientPreferences,
  budgetRemainingIdr: number | null
): Candidate[] {
  const coords = bucketCoords(residual);
  const key = coords.join(",");
  const hit = cache.store.get(key);
  if (hit) return hit.candidates;
  if (cache.store.size >= cache.limit) {
    let nearest: { coords: number[]; candidates: Candidate[] } | null = null;
    let nearestDistance = Infinity;
    for (const entry of cache.store.values()) {
      let distance = 0;
      for (let index = 0; index < coords.length; index += 1) {
        distance += Math.abs(entry.coords[index] - coords[index]);
      }
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = entry;
      }
    }
    return nearest?.candidates ?? [];
  }
  const candidates = composedCandidates(plan.slot, residual, slotsRemaining,
    slotShare, preferences, budgetRemainingIdr);
  cache.store.set(key, { coords, candidates });
  return candidates;
}

interface CompleteDay {
  picks: Candidate[];
  macros: Macros;
  priceIdr: number;
  diagnostics: DailyAdherenceDiagnostics;
  /**
   * Set when the day was found by locking one choice in place. Such a day
   * exists precisely because the ordinary search was not going to produce it,
   * which is also why plain rank would drop it again.
   */
  anchor?: string;
}

/** Internal input shape exported only to support bounded day-pool unit tests. */
export type TestingCompleteDay = CompleteDay;

/**
 * One slot's choices, fixed in advance, with the rest of the day solved around
 * them. Holding several at once rather than one per search is deliberate: the
 * beam's coverage pass keeps every distinct style alive at every depth, so five
 * locked breakfasts explored together each get a fair share of the search for
 * roughly the price of one.
 */
interface ForcedSlot {
  slotIndex: number;
  candidates: Candidate[];
}

function searchCompleteDays(
  fillable: SlotPlan[],
  target: MacroTargets,
  options: GenerateOptions,
  preferences: ClientPreferences,
  budget: number | null,
  complete: boolean,
  allowRepeats = false,
  forced?: ForcedSlot,
  caches?: ComposedCache[]
): CompleteDay[] {
  if (forced && (forced.slotIndex < 0 || forced.slotIndex >= fillable.length)) return [];
  if (forced && !forced.candidates.length) return [];
  const width = forced ? LOCKED_BEAM_WIDTH : BEAM_WIDTH;
  const core = forced ? LOCKED_BEAM_MACRO_CORE : BEAM_MACRO_CORE;
  const suffix: MacroRange[] = new Array(fillable.length + 1);
  suffix[fillable.length] = emptyRange();
  for (let index = fillable.length - 1; index >= 0; index -= 1) {
    const reach = forced?.slotIndex === index
      ? rangeOver(forced.candidates)
      : fillable[index].reach;
    suffix[index] = addRange(reach, suffix[index + 1]);
  }

  let beam: DayState[] = [{
    picks: [], macros: { ...EMPTY_MACROS }, priceIdr: 0, shapes: [], leaned: 0,
    infeasibility: 0, slack: 0, pathKey: "",
  }];

  for (let index = 0; index < fillable.length; index += 1) {
    const plan = fillable[index];
    const remainingWeight = fillable.slice(index).reduce((sum, item) => sum + item.weight, 0);
    const share = remainingWeight > 0 ? plan.weight / remainingWeight : 1;
    const forcedDepth = forced?.slotIndex === index;
    const searchPlan = forcedDepth
      ? { ...plan, ready: forced.candidates, reach: rangeOver(forced.candidates) }
      : plan;
    const cache = caches?.[index] ?? plan.composed;
    const depthOptions = { ...options,
      includeComposed: forcedDepth ? false : options.includeComposed };
    const expanded = expandDepth(beam, searchPlan, cache, index, fillable.length, share,
      suffix[index + 1], target, depthOptions, preferences, budget, allowRepeats);
    // A duplicate ban must never leave a slot unfillable. When nothing survives
    // it, the depth is replayed with repeats allowed — the explicit fallback,
    // not the normal path.
    beam = retainBeam(expanded.length ? expanded
      : expandDepth(beam, searchPlan, cache, index, fillable.length, share, suffix[index + 1],
        target, depthOptions, preferences, budget, true), index,
      preferences.proteinLean.length > 0, width, core);
    if (!beam.length) return [];
  }

  return beam.map((state) => ({
    picks: state.picks,
    macros: state.macros,
    priceIdr: state.priceIdr,
    diagnostics: diagnoseDailyAdherence(state.macros, target, { complete }),
    ...(forced ? { anchor: `${forced.slotIndex}|${state.picks[forced.slotIndex].dishShape}` } : {}),
  }));
}

function expandDepth(
  beam: DayState[],
  plan: SlotPlan,
  cache: ComposedCache,
  index: number,
  slotCount: number,
  share: number,
  reachable: MacroRange,
  target: MacroTargets,
  options: GenerateOptions,
  preferences: ClientPreferences,
  budget: number | null,
  allowRepeats: boolean
): DayState[] {
  const expanded: DayState[] = [];
  const slotsRemaining = slotCount - index;
  for (const state of beam) {
    const residual = remainingTarget(target, state.macros);
    // The remaining budget shapes what the composer bothers to build; the
    // authoritative check is the whole-day one below, because composed sets are
    // cached per residual and a cached set may have been built for a state that
    // had spent a little more or less.
    const pool = options.includeComposed === false
      ? plan.ready
      : [...plan.ready, ...composedFor(plan, cache, residual, slotsRemaining, share,
        preferences, budget === null ? null : budget - state.priceIdr)];
    for (const candidate of pool) {
      const priceIdr = state.priceIdr + candidate.priceIdr;
      if (budget !== null && priceIdr > budget) continue;
      if (!allowRepeats && state.shapes.includes(candidate.dishShape)) continue;
      const macros = addInto(state.macros, candidate.macros);
      const estimate = estimateCompletion(remainingTarget(target, macros), reachable, target);
      expanded.push({
        picks: [...state.picks, candidate],
        macros,
        priceIdr,
        shapes: [...state.shapes, candidate.dishShape],
        leaned: state.leaned + (candidate.leaned ? 1 : 0),
        infeasibility: estimate.infeasibility,
        slack: estimate.slack,
        pathKey: `${state.pathKey}|${candidate.id}`,
      });
    }
  }
  return expanded;
}

/**
 * Retention is feasibility first, then coverage.
 *
 * Ranking alone fills the beam with portion variations of one plate and quietly
 * deletes every beef, fish and egg path before the day is even complete — which
 * is how a week ends up identical seven times over. The macro core protects
 * adherence; a coverage pass per slot filled so far then guarantees that every
 * distinct choice already made keeps at least one surviving continuation, so a
 * lunch is not erased at dinner for having a slightly worse partial score.
 */
function retainBeam(expanded: DayState[], depth: number,
  preferenceActive: boolean, width = BEAM_WIDTH, macroCore = BEAM_MACRO_CORE): DayState[] {
  const ordered = sortStates(expanded);
  if (ordered.length <= macroCore) return ordered;
  const kept = ordered.slice(0, macroCore);
  const taken = new Set(kept.map((state) => state.pathKey));
  const stages = depth + 1 + (preferenceActive ? 1 : 0);
  const quota = Math.max(1, Math.floor((width - macroCore) / stages));

  // A lean is a preference, so it may not touch how a partial day is *ranked*.
  // It may keep the leaning paths alive through pruning, which is a different
  // thing: without this the beam can discard every fish route on macro grounds
  // alone and leave "more fish" with nothing to prefer later.
  if (preferenceActive) {
    coverageFill(ordered, kept, taken, Math.min(width, kept.length + quota),
      (state) => state.pathKey, (state) => String(state.leaned));
  }

  // Coverage groups by *style*, not by exact dish.
  //
  // Grouping by dish spreads the budget over eighty composed breakfasts that are
  // mostly portion variations of the same few plates, leaving each of them a
  // single surviving continuation — and a single continuation usually cannot
  // find a compliant day. Grouping by style spends the same budget on ten real
  // alternatives with enough paths each to finish, which is what actually
  // reaches the weekly pass.
  for (let slot = 0; slot <= depth && kept.length < width; slot += 1) {
    const limit = Math.min(width, kept.length + quota);
    coverageFill(ordered, kept, taken, limit,
      (state) => state.pathKey, (state) => state.picks[slot].dishStyle);
  }
  for (let slot = 0; slot <= depth && kept.length < width; slot += 1) {
    const limit = Math.min(width, kept.length + Math.ceil(quota / 2));
    coverageFill(ordered, kept, taken, limit,
      (state) => state.pathKey, (state) => state.picks[slot].dishShape);
  }
  if (kept.length < width) {
    for (const state of ordered) {
      if (kept.length >= width) break;
      if (taken.has(state.pathKey)) continue;
      taken.add(state.pathKey);
      kept.push(state);
    }
  }
  return kept;
}

/**
 * Round-robin over groups, best member first, until `limit` is reached. Every
 * group gets one before any group gets two, which is what makes the kept set
 * independent of the order the candidates were generated in.
 *
 * Groups already represented in `kept` go last. Sorting by name alone was
 * enough while each call filled a large slice in one go, but not when the
 * caller cycles slots a couple of entries at a time: the alphabetically first
 * group won every call, and the pool filled up with one breakfast again.
 */
function coverageFill<T>(
  ordered: readonly T[],
  kept: T[],
  taken: Set<string>,
  limit: number,
  identity: (item: T) => string,
  group: (item: T) => string
): void {
  const groups = new Map<string, T[]>();
  for (const item of ordered) {
    if (taken.has(identity(item))) continue;
    const key = group(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item); else groups.set(key, [item]);
  }
  const represented = new Map<string, number>();
  for (const item of kept) {
    const key = group(item);
    represented.set(key, (represented.get(key) ?? 0) + 1);
  }
  const keys = [...groups.keys()].sort((a, b) =>
    ((represented.get(a) ?? 0) - (represented.get(b) ?? 0)) ||
    (a < b ? -1 : a > b ? 1 : 0));
  const pointers = new Map<string, number>();
  let progressed = true;
  while (kept.length < limit && progressed) {
    progressed = false;
    for (const key of keys) {
      if (kept.length >= limit) break;
      const bucket = groups.get(key)!;
      let index = pointers.get(key) ?? 0;
      while (index < bucket.length && taken.has(identity(bucket[index]))) index += 1;
      pointers.set(key, index + 1);
      if (index >= bucket.length) continue;
      taken.add(identity(bucket[index]));
      kept.push(bucket[index]);
      progressed = true;
    }
  }
}

function sortStates(states: DayState[]): DayState[] {
  return [...states].sort((a, b) =>
    (a.infeasibility - b.infeasibility) ||
    (a.slack - b.slack) ||
    (a.pathKey < b.pathKey ? -1 : a.pathKey > b.pathKey ? 1 : 0));
}

// --- day pool ----------------------------------------------------------------

const ADHERENCE_RANK = {
  Exact: 0, "Within tolerance": 1, "Best effort": 2, Impossible: 3,
} as const;

/**
 * The standard a day is held to.
 *
 * "Exact" is a nicety inside compliance, not a separate standard: a day inside
 * the stated daily tolerance meets the macro requirement, and filtering it out
 * because some other day happened to land on the nose discards perfectly good
 * days — which is how a compliant 1,100 kcal pancake day disappeared while an
 * exact composed one existed. Ordering still prefers the more accurate day
 * everywhere below; only the wholesale discard is gone.
 */
function adherenceTier(classification: DailyAdherenceDiagnostics["classification"]): number {
  const rank = ADHERENCE_RANK[classification];
  return Math.max(rank, ADHERENCE_RANK["Within tolerance"]);
}

interface DayPlan {
  picks: Candidate[];
  macros: Macros;
  priceIdr: number;
  diagnostics: DailyAdherenceDiagnostics;
  /** Suitability, preferences, within-day repetition, accuracy, then price. */
  softScore: number;
  repeatKeys: RepeatKey[];
  keySet: Set<string>;
  exactSignature: string;
  familySignature: string;
  /** Meals whose protein family is one the plan leans toward. */
  leanedMeals: number;
  /** The locked choice this day was solved around, when it came from one. */
  anchor?: string;
}

function sameDayPenalty(picks: Candidate[]): number {
  let penalty = 0;
  for (const dimension of Object.keys(SAME_DAY_PENALTY) as VarietyDimension[]) {
    const weight = SAME_DAY_PENALTY[dimension]!;
    const seen = new Map<string, number>();
    for (const candidate of picks) {
      if (isSkipped(candidate)) continue;
      const relief = dimension === "proteinFamily" && candidate.leaned ? LEAN_REPEAT_RELIEF : 1;
      for (const value of varietyValues(candidate, dimension)) {
        const previous = seen.get(value) ?? 0;
        penalty += weight * relief * escalatingMultiplier(previous);
        seen.set(value, previous + 1);
      }
    }
  }
  return penalty;
}

function repeatKeysFor(picks: Candidate[], slots: string[]): RepeatKey[] {
  const keys: RepeatKey[] = [];
  picks.forEach((candidate, index) => {
    const slot = slots[index];
    // Leaving a slot out is one of the choices for it, and repeats like any
    // other: free the first time, escalating after that through the machinery
    // every dish already goes through. It has no families to repeat, so it
    // carries only its own identity and never lands in a real food's bucket.
    if (isSkipped(candidate)) {
      keys.push({ key: `s|${slot}|dish|${candidate.dishShape}`,
        weight: SLOT_REPEAT_PENALTY.exactDishIdentity });
      keys.push({ key: `g|dishShape|${candidate.dishShape}`,
        weight: GLOBAL_REPEAT_PENALTY.exactDishIdentity });
      return;
    }
    const breakfast = slotKindOf(slot) === "breakfast";
    const heavyBreakfast = breakfast &&
      HEAVY_BREAKFAST_FAMILIES.has(candidate.proteinFamily)
      ? HEAVY_BREAKFAST_MULTIPLIER : 1;
    const styleMultiplier = breakfast ? BREAKFAST_STYLE_MULTIPLIER : 1;
    for (const dimension of Object.keys(GLOBAL_REPEAT_PENALTY) as VarietyDimension[]) {
      const relief = dimension === "proteinFamily" && candidate.leaned ? LEAN_REPEAT_RELIEF : 1;
      const weight = GLOBAL_REPEAT_PENALTY[dimension] * relief;
      for (const value of varietyValues(candidate, dimension)) {
        keys.push({ key: `g|${dimension}|${value}`, weight });
      }
    }
    keys.push({ key: `s|${slot}|dish|${candidate.dishShape}`,
      weight: SLOT_REPEAT_PENALTY.exactDishIdentity * heavyBreakfast });
    keys.push({ key: `s|${slot}|style|${candidate.dishStyle}`,
      weight: SLOT_REPEAT_PENALTY.dishStyle * styleMultiplier });
    keys.push({ key: `s|${slot}|protein|${candidate.proteinFamily}`,
      weight: SLOT_REPEAT_PENALTY.proteinFamily * heavyBreakfast *
        (candidate.leaned ? LEAN_REPEAT_RELIEF : 1) });
    keys.push({ key: `s|${slot}|carb|${candidate.carbFamily}`,
      weight: SLOT_REPEAT_PENALTY.carbFamily });
    keys.push({ key: `s|${slot}|archetype|${candidate.mealArchetype}`,
      weight: SLOT_REPEAT_PENALTY.mealArchetype });
    keys.push({ key: `g|dishShape|${candidate.dishShape}`,
      weight: GLOBAL_REPEAT_PENALTY.exactDishIdentity });
  });

  const exact = picks.map((candidate) => candidate.dishShape).join(">");
  const family = picks.map((candidate) => candidate.familySignature).join(">");
  keys.push({ key: `d|exact|${exact}`, weight: DAY_REPEAT_PENALTY.exact });
  keys.push({ key: `d|family|${family}`, weight: DAY_REPEAT_PENALTY.family });
  const mains = picks
    .filter((_, index) => slotKindOf(slots[index]) === "main")
    .map((candidate) => candidate.dishShape)
    .sort();
  if (mains.length > 1) {
    keys.push({ key: `d|mains|${mains.join("+")}`, weight: DAY_REPEAT_PENALTY.mainsSwapped });
  }
  return keys;
}

function toDayPlan(day: CompleteDay, slots: string[]): DayPlan {
  const softScore =
    day.picks.reduce((sum, candidate) => sum + candidate.slotPenalty +
      (candidate.readyMadePriority === "high" ? -0.3 : 0) +
      (candidate.leaned ? -LEAN_BONUS : 0), 0) +
    sameDayPenalty(day.picks) +
    ADHERENCE_TIEBREAK_WEIGHT * day.diagnostics.normalizedError +
    pricePenalty(day.priceIdr);
  const repeatKeys = repeatKeysFor(day.picks, slots);
  return {
    picks: day.picks,
    macros: day.macros,
    priceIdr: day.priceIdr,
    diagnostics: day.diagnostics,
    softScore,
    repeatKeys,
    keySet: new Set(repeatKeys.map((entry) => entry.key)),
    exactSignature: day.picks.map((candidate) => candidate.dishShape).join(">"),
    familySignature: day.picks.map((candidate) => candidate.familySignature).join(">"),
    leanedMeals: day.picks.filter((candidate) => candidate.leaned).length,
    ...(day.anchor ? { anchor: day.anchor } : {}),
  };
}

/**
 * The pool the week is chosen from.
 *
 * Which days are eligible is `bestEquivalentDays`'s answer, not this function's:
 * the best standard wins outright, every day inside a compliant class stays
 * because each already satisfies the stated tolerance, and the standard widens
 * only where it cannot otherwise fill the week. What happens here is the
 * trimming — dedupe, rank, and reserve room per slot, per locked choice, per
 * preference and per price, so the weekly pass is handed genuine alternatives
 * rather than forty variations of one day.
 */
function selectDayPool(
  days: CompleteDay[],
  slots: string[],
  /** Distinct days the caller needs; the standard widens only if it must. */
  minimum = 1
): DayPlan[] {
  if (!days.length) return [];
  // One definition of "worth choosing between", shared with the caller that
  // assembles the day list — two copies of it meant the widening done there was
  // quietly undone here.
  const eligible = bestEquivalentDays(days, minimum);

  const unique = new Map<string, DayPlan>();
  for (const day of eligible) {
    const plan = toDayPlan(day, slots);
    const existing = unique.get(plan.exactSignature);
    if (!existing || rankDayPlan(plan) < rankDayPlan(existing)) {
      unique.set(plan.exactSignature, plan);
    }
  }
  const ordered = [...unique.values()].sort((a, b) => (rankDayPlan(a) - rankDayPlan(b)) ||
    (a.exactSignature < b.exactSignature ? -1 : 1));
  if (ordered.length <= DAY_POOL_CORE) return ordered;

  // How often one choice may occupy a slot in the pool.
  //
  // Coverage alone was not enough. Guaranteeing that every distinct breakfast
  // appears *somewhere* still let rank fill the rest of the pool with a single
  // one — forty-eight days, thirty-eight of them the same breakfast — and a
  // weekly solver cannot rotate between days it was never given. A share is
  // reserved per choice instead, so no slot can be monopolised while genuine
  // alternatives are sitting unused.
  const stages = Math.max(1, slots.length);
  const caps = Array.from({ length: stages }, (_, slot) => {
    const distinct = new Set(ordered.map((plan) => plan.picks[slot]?.dishShape ?? "")).size;
    return Math.max(2, Math.ceil(DAY_POOL_SIZE / Math.max(1, distinct)));
  });

  const pool: DayPlan[] = [];
  const taken = new Set<string>();
  const used = Array.from({ length: stages }, () => new Map<string, number>());

  const add = (plan: DayPlan, enforceCaps: boolean): boolean => {
    if (taken.has(plan.exactSignature)) return false;
    if (enforceCaps && plan.picks.some((candidate, slot) =>
      (used[slot]?.get(candidate.dishShape) ?? 0) >= (caps[slot] ?? DAY_POOL_SIZE))) {
      return false;
    }
    taken.add(plan.exactSignature);
    pool.push(plan);
    plan.picks.forEach((candidate, slot) => {
      used[slot]?.set(candidate.dishShape, (used[slot]?.get(candidate.dishShape) ?? 0) + 1);
    });
    return true;
  };

  const fill = (limit: number, order: readonly DayPlan[], enforceCaps = true): void => {
    for (const plan of order) {
      if (pool.length >= limit) break;
      add(plan, enforceCaps);
    }
  };

  /**
   * Round-robin over one slot's distinct choices, best day per choice.
   *
   * Caps stop a slot being monopolised; this is what gets the alternatives in
   * at all. Rank order alone reaches the second-best breakfast only after every
   * variation of the best one, and a cap on lunch or dinner then rejects it —
   * so the scarce slot is filled first, on its own terms.
   */
  const breadth = (slot: number, limit: number): void => {
    const groups = new Map<string, DayPlan[]>();
    for (const plan of ordered) {
      if (taken.has(plan.exactSignature)) continue;
      const key = plan.picks[slot]?.dishShape ?? "";
      const bucket = groups.get(key);
      if (bucket) bucket.push(plan); else groups.set(key, [plan]);
    }
    const keys = [...groups.keys()].sort((a, b) =>
      ((used[slot]?.get(a) ?? 0) - (used[slot]?.get(b) ?? 0)) ||
      (a < b ? -1 : a > b ? 1 : 0));
    const cursors = new Map<string, number>();
    let progressed = true;
    while (pool.length < limit && progressed) {
      progressed = false;
      for (const key of keys) {
        if (pool.length >= limit) break;
        const bucket = groups.get(key)!;
        let index = cursors.get(key) ?? 0;
        while (index < bucket.length && taken.has(bucket[index].exactSignature)) index += 1;
        cursors.set(key, index + 1);
        if (index >= bucket.length) continue;
        add(bucket[index], false);
        progressed = true;
      }
    }
  };

  // Best-adhering days first, then the days that best match the protein lean,
  // then the cheapest — each capped, so none of them can crowd out a slot.
  fill(DAY_POOL_CORE, ordered);

  // One place per distinct locked choice before any of them gets two, so a
  // single proven dish cannot spend the whole reservation either.
  const anchored = new Map<string, DayPlan[]>();
  for (const plan of ordered) {
    if (!plan.anchor || taken.has(plan.exactSignature)) continue;
    const bucket = anchored.get(plan.anchor);
    if (bucket) bucket.push(plan); else anchored.set(plan.anchor, [plan]);
  }
  const anchorLimit = Math.min(DAY_POOL_SIZE, pool.length + DAY_POOL_ANCHOR_SLICE);
  for (let round = 0; pool.length < anchorLimit; round += 1) {
    let progressed = false;
    for (const bucket of anchored.values()) {
      if (pool.length >= anchorLimit) break;
      const plan = bucket[round];
      if (!plan) continue;
      if (add(plan, false)) progressed = true;
    }
    if (!progressed) break;
  }

  // Scarcest slot first: breakfast has the fewest genuinely different options,
  // so it is the one that loses its alternatives if another slot spends the
  // room first.
  const share = Math.max(2, Math.ceil((DAY_POOL_SIZE - DAY_POOL_CORE) / stages));
  const byScarcity = Array.from({ length: stages }, (_, slot) => slot).sort((a, b) =>
    (new Set(ordered.map((plan) => plan.picks[a]?.dishShape ?? "")).size -
      new Set(ordered.map((plan) => plan.picks[b]?.dishShape ?? "")).size) || (a - b));
  for (const slot of byScarcity) {
    breadth(slot, Math.min(DAY_POOL_SIZE, pool.length + share));
  }
  if (ordered.some((plan) => plan.leanedMeals > 0)) {
    fill(pool.length + DAY_POOL_PREFERENCE_SLICE, [...ordered].sort((a, b) =>
      (b.leanedMeals - a.leanedMeals) || (rankDayPlan(a) - rankDayPlan(b)) ||
      (a.exactSignature < b.exactSignature ? -1 : 1)));
  }
  fill(pool.length + DAY_POOL_AFFORDABLE_SLICE, [...ordered].sort((a, b) =>
    (a.priceIdr - b.priceIdr) || (rankDayPlan(a) - rankDayPlan(b)) ||
    (a.exactSignature < b.exactSignature ? -1 : 1)));
  fill(DAY_POOL_SIZE, ordered);
  // Relax the caps only once every capped day is already in: a small pool of
  // near-identical days still beats a pool that is short.
  fill(DAY_POOL_SIZE, ordered, false);
  return pool;
}

/** Test seam for exercising pool retention without running the full planner. */
export const __selectDayPoolForTests = selectDayPool;

function rankDayPlan(plan: DayPlan): number {
  return plan.diagnostics.normalizedError + plan.softScore * 0.01;
}

// --- weekly assignment -------------------------------------------------------

interface WeekState {
  picks: DayPlan[];
  counts: Map<string, number>;
  previous: Set<string>;
  cost: number;
  pathKey: string;
}

/**
 * One day per weekday, chosen together rather than one at a time.
 *
 * Generating Monday, locking it, and only then asking what Tuesday should be is
 * what produced a week of near-clones: each day was individually optimal and
 * the set was terrible. A second beam over the whole week lets a slightly
 * different Monday pay for a much more varied Tuesday through Sunday.
 */
function solveWeek(pool: DayPlan[], dayCount: number, seed: number): DayPlan[] {
  if (!pool.length) return [];
  let beam: WeekState[] = [{
    picks: [], counts: new Map(), previous: new Set(), cost: 0, pathKey: "",
  }];
  for (let day = 0; day < dayCount; day += 1) {
    const expanded: { parent: WeekState; plan: DayPlan; cost: number; pathKey: string }[] = [];
    for (const state of beam) {
      for (const plan of pool) {
        const cost = state.cost + plan.softScore +
          repetitionCost(plan.repeatKeys, state.counts, state.previous);
        expanded.push({ parent: state, plan, cost,
          pathKey: `${state.pathKey}|${plan.exactSignature}` });
      }
    }
    expanded.sort((a, b) => (a.cost - b.cost) ||
      (a.pathKey < b.pathKey ? -1 : a.pathKey > b.pathKey ? 1 : 0));
    // Coverage again, for the same reason as inside a day: keeping only the
    // cheapest continuations leaves Shuffle a choice between seven weeks that
    // differ by one meal. Every distinct day still in play keeps a week alive.
    const retained = expanded.slice(0, WEEK_BEAM_CORE);
    coverageFill(expanded, retained, new Set(retained.map((entry) => entry.pathKey)),
      WEEK_BEAM_WIDTH, (entry) => entry.pathKey, (entry) => entry.plan.exactSignature);
    beam = retained.map((entry) => {
      const counts = new Map(entry.parent.counts);
      applyRepetition(counts, entry.plan.repeatKeys);
      return {
        picks: [...entry.parent.picks, entry.plan],
        counts,
        previous: entry.plan.keySet,
        cost: entry.cost,
        pathKey: entry.pathKey,
      };
    });
  }

  const ranked = [...beam].sort((a, b) => (a.cost - b.cost) ||
    (a.pathKey < b.pathKey ? -1 : a.pathKey > b.pathKey ? 1 : 0));
  const bestCost = ranked[0].cost;
  const window = ranked.filter((state) =>
    state.cost <= bestCost + WEEK_COST_EQUIVALENCE_PER_DAY * Math.max(1, dayCount));
  const finalists = window.length >= MIN_WEEK_FINALISTS ? window
    : ranked.slice(0, MIN_WEEK_FINALISTS);
  // The seed is a final tie-breaker only. Every finalist holds the same
  // adherence classification for every day, so a seed reshuffles equivalents
  // and can never demote a day.
  return seededChoice(seed, finalists).picks;
}

// --- diagnostics -------------------------------------------------------------

/**
 * Whether kitchen portion granularity is genuinely why a day misses.
 *
 * The old code asserted this whenever a non-compliant day contained a composed
 * meal, which is a guess, not a reason: the cause is just as often the budget,
 * the avoid list, or the menu simply not containing a combination that adds up.
 * The claim is only made when a single serving step in the failing macro is
 * wider than the entire tolerance window — the one case where no adjustment
 * available to the kitchen could land inside it.
 */
export function kitchenIncrementsPreventCompliance(
  picks: { kind: "composed" | "ready"; items: DishItem[] }[],
  diagnostics: DailyAdherenceDiagnostics,
  target: MacroTargets
): boolean {
  if (!diagnostics.failureDimensions.length) return false;
  const steps = picks
    .filter((pick) => pick.kind === "composed")
    .flatMap((pick) => pick.items)
    .flatMap((item) => {
      const ingredient = getIngredient(item.ingredientId);
      const quantity = ingredient?.diy_quantity;
      if (!ingredient || !quantity) return [];
      return [perItemMacros(ingredient, quantity.arbitrary_quantities_supported
        ? quantity.increment_g : quantity.preferred_g)];
    });
  if (!steps.length) return false;
  return diagnostics.failureDimensions.some((key) => {
    const smallest = Math.min(...steps.map((step) => Math.abs(step[key])));
    return smallest > 2 * dailyTolerance(key, target[key]);
  });
}

// --- generation --------------------------------------------------------------

export class InvalidMacroTargetError extends Error {
  readonly code = "INVALID_TARGET_MACRO_ENERGY_MISMATCH" as const;
  constructor(
    readonly requestedEnergyKcal: number,
    readonly macroEnergyKcal: number,
    readonly differenceKcal: number,
    readonly differencePercent: number
  ) {
    super(`Macro grams represent ${macroEnergyKcal.toFixed(1)} kcal, not ${requestedEnergyKcal.toFixed(1)} kcal.`);
    this.name = "InvalidMacroTargetError";
  }
}

const FORCED_REPRESENTATIVE_MIN = 6;
const FORCED_REPRESENTATIVE_MAX = 12;

/**
 * How many unproven ready choices one slot may put through a locked search.
 *
 * Ready dishes are used whole, on their published macros — the search cannot
 * resize one to fit what a day has left. A 1,095 kcal pancake therefore has to
 * survive beam pruning on the strength of a partial day it was never going to
 * look good in, and it does not: it is dropped long before the lunch and dinner
 * that would have made the day add up. The only honest way to tell "no day that
 * adheres can contain this dish" from "the beam lost it before dinner" is to fix
 * the dish in its slot and solve the whole day around it.
 *
 * Only choices no compliant day already contains go through it, so a catalog the
 * ordinary search already covers costs nothing at all.
 */
const ANCHORED_CHOICES_PER_SLOT = 12;

/**
 * Residuals the locked pass composes for, per slot.
 *
 * Deliberately deeper than the ordinary ceiling, and it is what makes the pass
 * work at all: a locked 1,095 kcal breakfast leaves a residual no ordinary day
 * ever produces, so falling back on the nearest already-composed bucket hands
 * it lunches built for a different day and turns a provably compliant pancake
 * day into a Best effort one. One cache serves every locked search — they share
 * residuals, and composing is where the time goes.
 */
const ANCHORED_RESIDUAL_BUCKETS = 32;

function subtractRange(a: MacroRange, b: MacroRange): MacroRange {
  const out = emptyRange();
  for (const key of DAILY_MACRO_KEYS) {
    out.min[key] = a.min[key] - b.min[key];
    out.max[key] = a.max[key] - b.max[key];
  }
  return out;
}

function slotNeedsRecovery(days: CompleteDay[], slotIndex: number): boolean {
  if (!days.length) return true;
  const candidates = days.map((day) => day.picks[slotIndex]).filter(Boolean);
  if (!candidates.length) return true;
  const shapes = new Set(candidates.map((candidate) => candidate.dishShape));
  const styles = new Set(candidates.map((candidate) => candidate.dishStyle));
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.id, (counts.get(candidate.id) ?? 0) + 1);
  }
  const largestShare = Math.max(...counts.values()) / candidates.length;
  return shapes.size === 1 || styles.size === 1 || largestShare > 0.7;
}

/**
 * A small, portion-independent cross-section of a slot's explored catalog.
 * Breakfast keeps its historical emphasis on style; the same greedy coverage
 * then gives every slot independent family and cuisine representation.
 *
 * Nothing here consults how large a meal is. Ordering candidates by their
 * distance from a slot-sized share of the target — which is what this did — was
 * the last place the planner still assumed breakfast should be breakfast-sized,
 * and it sorted every oversized ready dish out of the cross-section before the
 * whole day was ever considered.
 */
function forcedRepresentatives(plan: SlotPlan): Candidate[] {
  const candidates = [...plan.ready,
    ...[...plan.composed.store.values()].flatMap((entry) => entry.candidates)]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const byShape = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (!byShape.has(candidate.dishShape)) byShape.set(candidate.dishShape, candidate);
  }
  let available = [...byShape.values()];
  if (slotKindOf(plan.slot) === "breakfast") {
    const perStyle = new Map<string, number>();
    available = available.filter((candidate) => {
      const count = perStyle.get(candidate.dishStyle) ?? 0;
      if (count >= 3) return false;
      perStyle.set(candidate.dishStyle, count + 1);
      return true;
    });
  }

  const selected: Candidate[] = [];
  const covered = new Set<string>();
  while (available.length && selected.length < FORCED_REPRESENTATIVE_MAX) {
    let bestIndex = 0;
    let bestNovelty = -1;
    for (let index = 0; index < available.length; index += 1) {
      const candidate = available[index];
      const dimensions = [
        `shape:${candidate.dishShape}`,
        `style:${candidate.dishStyle}`,
        `protein:${candidate.proteinFamily}`,
        `carb:${candidate.carbFamily}`,
        `cuisine:${candidate.cuisineFamily}`,
      ];
      let novelty = dimensions.filter((value) => !covered.has(value)).length;
      if (slotKindOf(plan.slot) === "breakfast" && !covered.has(dimensions[1])) novelty += 2;
      if (novelty > bestNovelty) {
        bestNovelty = novelty;
        bestIndex = index;
      }
    }
    const [candidate] = available.splice(bestIndex, 1);
    selected.push(candidate);
    covered.add(`shape:${candidate.dishShape}`);
    covered.add(`style:${candidate.dishStyle}`);
    covered.add(`protein:${candidate.proteinFamily}`);
    covered.add(`carb:${candidate.carbFamily}`);
    covered.add(`cuisine:${candidate.cuisineFamily}`);
    if (bestNovelty <= 1 && selected.length >= FORCED_REPRESENTATIVE_MIN) break;
  }
  return selected;
}

/** Ready choices in one slot that a compliant day has already produced. */
function provenReady(
  fillable: SlotPlan[],
  slotIndex: number,
  explored: CompleteDay[]
): Set<string> {
  const proven = new Set<string>();
  for (const day of explored) {
    if (!day.diagnostics.compliant) continue;
    const pick = day.picks[slotIndex];
    if (pick) proven.add(pick.dishShape);
  }
  return proven;
}

/** The ready choices in one slot that no compliant day has produced yet. */
function unprovenReady(
  fillable: SlotPlan[],
  slotIndex: number,
  proven: Set<string>,
  target: MacroTargets
): Candidate[] {
  const plan = fillable[slotIndex];
  const seen = new Set(proven);
  const elsewhere = subtractRange(
    fillable.reduce((sum, entry) => addRange(sum, entry.reach), emptyRange()), plan.reach);

  const unproven: Candidate[] = [];
  for (const candidate of [...plan.ready].sort((a, b) =>
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (unproven.length >= ANCHORED_CHOICES_PER_SLOT) break;
    // Going without commits nothing, so there is nothing to prove: the ordinary
    // search weighs that choice on exactly the same terms this one would.
    if (isSkipped(candidate)) continue;
    if (seen.has(candidate.dishShape)) continue;
    seen.add(candidate.dishShape);
    // A sound bound, and only that: `infeasibility` counts tolerance units the
    // rest of the day provably cannot cover, and a compliant day is allowed one
    // per macro. Past that, no lunch, dinner or snack could rescue it and the
    // search would only prove what the arithmetic already says. Nothing here
    // compares a dish to a share of the target.
    const residual = remainingTarget(target, candidate.macros);
    if (estimateCompletion(residual, elsewhere, target).infeasibility > 1) continue;
    unproven.push(candidate);
  }
  return unproven;
}

const daySignature = (day: CompleteDay): string =>
  day.picks.map((candidate) => candidate.dishShape).join(">");

/**
 * The days worth choosing between, and enough of them to fill a week.
 *
 * The best standard wins, as ever. But a target can be hard enough that only one
 * or two combinations meet it — 180 g of protein inside 50 g of fat is two days
 * on this menu — and a week built from two days is the same two dinners over and
 * over, which is not a better answer than seven days where five of them are a
 * few grams outside a line we drew ourselves. So when the best class cannot fill
 * the week, the next-closest days are admitted, closest first, until it can.
 *
 * Never more than that: the days let in are the nearest misses there are, and
 * the moment there is genuine choice inside the standard, nothing outside it
 * gets in at all.
 */
function bestEquivalentDays(days: CompleteDay[], minimum = 1): CompleteDay[] {
  if (!days.length) return [];
  const bestRank = Math.min(...days.map((day) =>
    adherenceTier(day.diagnostics.classification)));
  const ranked = days.filter((day) =>
    adherenceTier(day.diagnostics.classification) === bestRank);
  const bestError = Math.min(...ranked.map((day) => day.diagnostics.normalizedError));
  const kept = bestRank <= ADHERENCE_RANK["Within tolerance"] ? ranked
    : ranked.filter((day) =>
      day.diagnostics.normalizedError <= bestError + UNREACHABLE_DAY_ERROR_EQUIVALENCE);

  const distinct = new Set(kept.map(daySignature));
  if (distinct.size >= minimum) return kept;

  // Closest first, so what comes in is always the least compromise available.
  const rest = days
    .filter((day) => !kept.includes(day))
    .sort((a, b) => a.diagnostics.normalizedError - b.diagnostics.normalizedError);
  const extended = [...kept];
  for (const day of rest) {
    if (distinct.size >= minimum) break;
    extended.push(day);
    distinct.add(daySignature(day));
  }
  return extended;
}

/** Everything a day search needs, resolved once and shared by every pass. */
interface DaySearch {
  resolution: ReturnType<typeof resolveTarget>;
  target: MacroTargets;
  preferences: ClientPreferences;
  budget: number | null;
  fillable: SlotPlan[];
  slotNames: string[];
  unfilledSlots: string[];
  complete: boolean;
}

function prepareDaySearch(options: GenerateOptions): DaySearch {
  const resolution = resolveTarget({
    targets: options.targets,
    style: options.targetStyle ?? options.preferences?.macroStyle,
  });
  const target = resolution.target;
  const validation = validateMacroTarget(target);
  if (!validation.valid) {
    throw new InvalidMacroTargetError(target.energy_kcal, validation.macroEnergyKcal,
      validation.differenceKcal, validation.differencePercent);
  }
  const preferences = options.preferences ?? DEFAULT_PREFERENCES;
  const slots = options.slots.length ? options.slots : ["Meal"];
  const budget = options.dailyBudgetIdr && options.dailyBudgetIdr > 0
    ? options.dailyBudgetIdr : null;

  const weights = slots.map(slotWeight);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1;
  const optional = optionalSlots(slots);

  const plans: SlotPlan[] = slots.map((slot, index) => {
    const ready = readyCandidates(slot, options.includeSavedDishes ? options.savedDishes : [],
      options.includeMenuDishes, budget, preferences, options.candidateFixtures);
    // Going without is one of this slot's choices, so it belongs in the same list
    // as the rest. It also pulls the slot's reachable minimum down to zero, which
    // is what lets the search see a day whose breakfast is most of the target as
    // something it can still finish.
    if (optional.has(slot)) ready.push(skippedCandidate(slot));
    const share = weights[index] / weightTotal;
    // Reachability is probed at a light and a heavy serving of this slot, which
    // is what lets the search tell "this path can still be rescued" from "this
    // path is already impossible" without enumerating the menu.
    const probes = options.includeComposed === false ? [] : [0.6, 1.6].flatMap((factor) =>
      composedCandidates(slot, {
        energy_kcal: target.energy_kcal * share * factor,
        protein_g: target.protein_g * share * factor,
        carbs_g: target.carbs_g * share * factor,
        fat_g: target.fat_g * share * factor,
      }, 1, 1, preferences, budget));
    return {
      slot,
      weight: weights[index],
      optional: optional.has(slot),
      ready,
      reach: rangeOver([...ready, ...probes]),
      composed: composedCache(),
    };
  });

  const fillable = plans.filter((plan) => plan.ready.length || plan.reach.max.energy_kcal > 0);
  // Only a slot the day actually needs can leave it short. An optional slot always
  // holds at least the choice of going without, so it never appears here.
  const unfilledSlots = plans.filter((plan) => !fillable.includes(plan)).map((plan) => plan.slot);

  return {
    resolution, target, preferences, budget, fillable,
    slotNames: fillable.map((plan) => plan.slot),
    unfilledSlots,
    complete: unfilledSlots.length === 0,
  };
}

/** Every complete day worth choosing between, in priority order. */
function buildDayPool(search: DaySearch, options: GenerateOptions): DayPlan[] {
  const { fillable, target, preferences, budget, complete, slotNames } = search;
  const ordinaryDays = searchCompleteDays(fillable, target, options, preferences,
    budget, complete);
  // A locked search over everything a slot offers whole and has not already
  // proved itself, given composed meals built for the day that choice actually
  // leaves behind — the difference between asking whether a large dish can work
  // and assuming it cannot. Least-covered slots first, and only as many as the
  // budget allows.
  const proven = fillable.map((_, slotIndex) =>
    provenReady(fillable, slotIndex, ordinaryDays));
  const unproven = fillable.map((_, slotIndex) =>
    unprovenReady(fillable, slotIndex, proven[slotIndex], target));
  // Least-covered slot first, and never one with nothing left to prove: the
  // snack slot holds no ready dish at all on this menu, and a search with an
  // empty pool is pure cost.
  const lockedSlots = fillable
    .map((_, slotIndex) => slotIndex)
    .filter((slotIndex) => unproven[slotIndex].length > 0)
    .sort((a, b) => (proven[a].size - proven[b].size) || (a - b));
  const lockedCaches = fillable.map((plan) =>
    composedCache(ANCHORED_RESIDUAL_BUCKETS, plan.composed));
  const anchoredDays = lockedSlots.flatMap((slotIndex) =>
    searchCompleteDays(fillable, target, options, preferences, budget, complete, false,
      { slotIndex, candidates: unproven[slotIndex] }, lockedCaches));

  const explored = [...ordinaryDays, ...anchoredDays];
  const bestRank = explored.length
    ? Math.min(...explored.map((day) => adherenceTier(day.diagnostics.classification)))
    : Number.POSITIVE_INFINITY;
  const bestDays = explored.filter((day) =>
    adherenceTier(day.diagnostics.classification) === bestRank);
  const recoveredDays = fillable.flatMap((plan, slotIndex) =>
    slotNeedsRecovery(bestDays, slotIndex)
      ? forcedRepresentatives(plan).flatMap((candidate) =>
        searchCompleteDays(fillable, target, options, preferences, budget, complete, false,
          { slotIndex, candidates: [candidate] }))
      : []);

  // A week needs one day per weekday to rotate between; anything less and the
  // same day comes round again however varied the catalog is.
  let pool = selectDayPool([...explored, ...recoveredDays], slotNames, options.days.length);
  // The explicit fallback. Normal generation never serves the same dish twice in
  // a day, but a ban is not worth an infeasible day: when nothing compliant can
  // be built without repeating, the search is rerun with repeats permitted and
  // kept only if it genuinely adheres better.
  if (!pool.length || !pool[0].diagnostics.compliant) {
    const relaxed = selectDayPool(
      searchCompleteDays(fillable, target, options, preferences, budget, complete, true),
      slotNames);
    if (relaxed.length && (!pool.length ||
        adherenceTier(relaxed[0].diagnostics.classification) <
          adherenceTier(pool[0].diagnostics.classification) ||
        (adherenceTier(relaxed[0].diagnostics.classification) ===
            adherenceTier(pool[0].diagnostics.classification) &&
          relaxed[0].diagnostics.normalizedError <
            pool[0].diagnostics.normalizedError - COMPLETE_DAY_ERROR_EQUIVALENCE))) {
      pool = relaxed;
    }
  }
  return pool;
}

function materializeDay(
  day: number,
  plan: DayPlan | undefined,
  search: DaySearch,
  usage: WeeklyVarietyUsage
): GeneratedDay {
  const { fillable, target, preferences, unfilledSlots, complete } = search;
  const meals: GeneratedMeal[] = [];
  const skippedSlots: string[] = [];
  let price: PriceResult = { ...ZERO_PRICE };
  (plan?.picks ?? []).forEach((candidate, pickIndex) => {
    const slot = fillable[pickIndex].slot;
    if (isSkipped(candidate)) {
      skippedSlots.push(slot);
      return;
    }
    recordWeeklyVariety(usage, candidate, slot);
    const mealPrice = candidate.kind === "ready" && candidate.priceIdr > 0
      ? { ...ZERO_PRICE, totalIdr: candidate.priceIdr }
      : priceItems(candidate.items);
    meals.push({
      slot,
      name: candidate.name,
      items: candidate.items,
      macros: candidate.macros,
      price: mealPrice,
      kind: candidate.kind,
      sourceDishId: candidate.sourceDishId,
      ...(candidate.menuRecipeId ? { menuRecipeId: candidate.menuRecipeId } : {}),
      dishStyle: candidate.dishStyle,
    });
    price = addPrices(price, mealPrice);
  });
  if (plan) recordDaySignature(usage, plan.exactSignature);
  const macros = plan?.macros ?? { ...EMPTY_MACROS };
  // A slot the day deliberately went without is not a slot it failed to fill, so
  // it has no bearing on whether the day is complete.
  const dayComplete = Boolean(plan) && complete;
  const provisional = diagnoseDailyAdherence(macros, target, { complete: dayComplete });
  return {
    day,
    meals,
    macros,
    price,
    unfilledSlots,
    skippedSlots,
    adherence: diagnoseDailyAdherence(macros, target, {
      complete: dayComplete,
      restrictionsApplied: preferences.avoidIngredientIds.length > 0,
      unavailableSlots: unfilledSlots,
      kitchenPortionsConstrained: dayComplete &&
        kitchenIncrementsPreventCompliance(plan?.picks ?? [], provisional, target),
    }),
  };
}

export function generatePlanWithTargets(options: GenerateOptions): GeneratedPlan {
  const search = prepareDaySearch(options);
  const pool = buildDayPool(search, options);
  const week = solveWeek(pool, options.days.length, options.seed ?? 1);

  const usage = createWeeklyVarietyUsage();
  const generated = options.days.map((day, index) =>
    materializeDay(day, week[index], search, usage));

  return {
    days: generated,
    resolvedTarget: search.target,
    targetSource: search.resolution.source,
    targetStyle: search.resolution.selectedStyle,
    targetExplanation: search.resolution.explanation,
  };
}

export function generatePlan(options: GenerateOptions): GeneratedDay[] {
  return generatePlanWithTargets(options).days;
}

/** A meal pinned to a slot, so the rest of the day can be solved around it. */
export interface LockedMeal {
  slot: string;
  /** Planner candidate id, e.g. `menu:special_protein_pancake`. */
  candidateId: string;
}

/**
 * One whole day, solved around a meal that is fixed in advance.
 *
 * This asks "can a day that adheres contain this dish?" directly, rather than
 * inferring it from whether the planner happened to pick the dish — which is not
 * the same question, and answering the second as though it were the first is how
 * the menu's largest breakfasts came to be written off as impossible. Returns
 * null when the slot or the dish is not part of this catalog.
 */
export function generateDayWithLockedMeal(
  options: GenerateOptions,
  lock: LockedMeal
): GeneratedDay | null {
  const search = prepareDaySearch(options);
  const slotIndex = search.fillable.findIndex((plan) => plan.slot === lock.slot);
  if (slotIndex < 0) return null;
  const candidate = search.fillable[slotIndex].ready
    .find((entry) => entry.id === lock.candidateId);
  if (!candidate) return null;

  const days = searchCompleteDays(search.fillable, search.target, options,
    search.preferences, search.budget, search.complete, false,
    { slotIndex, candidates: [candidate] },
    search.fillable.map(() => composedCache(ANCHORED_RESIDUAL_BUCKETS)));
  const pool = selectDayPool(bestEquivalentDays(days), search.slotNames);
  if (!pool.length) return null;
  return materializeDay(options.days[0] ?? 0, pool[0], search, createWeeklyVarietyUsage());
}

/**
 * Test seam: the days the weekly pass gets to choose between. Survival into the
 * pool is the guarantee worth asserting — what the week then picks is variety,
 * and a dish absent from the pool was never in the running at all.
 */
export function __dayPoolForTests(options: GenerateOptions): {
  meals: { slot: string; name: string }[];
  adherence: DailyAdherenceDiagnostics;
}[] {
  const search = prepareDaySearch(options);
  return buildDayPool(search, options).map((plan) => ({
    meals: plan.picks.flatMap((candidate, index) => isSkipped(candidate) ? []
      : [{ slot: search.fillable[index].slot, name: candidate.name }]),
    adherence: plan.diagnostics,
  }));
}

/**
 * How far a generated day lands from target, for showing accuracy in the UI.
 * Reads the same field list and percentage rule the adherence bars use, so the
 * preview inside the generator cannot disagree with the plan it produces.
 */
export function dayAccuracy(
  macros: Macros,
  targets: MacroTargets
): { key: string; label: string; actual: number; target: number; pct: number }[] {
  return TARGET_FIELDS.map((field) => {
    const actual = macros[field.macroKey];
    const target = targets[field.key];
    return {
      key: field.key,
      label: field.label,
      actual,
      target,
      pct: adherencePct(actual, target),
    };
  });
}
