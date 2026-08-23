import type { DiySection, Ingredient, Macros, PlannerCandidate } from "@/types/nutrition";
import { GRAM_UNIT_ID } from "@/types/nutrition";
import { diyMenu, getIngredient, menuRecipes } from "@/lib/database";
import { EMPTY_MACROS, addMacros, perItemMacros } from "@/lib/calc";
import { ZERO_PRICE, addPrices, priceItems, type PriceResult } from "@/lib/pricing";
import { TARGET_FIELDS, adherencePct } from "@/lib/clients";
import {
  diagnoseDailyAdherence,
  type DailyAdherenceDiagnostics,
  type MacroAdherenceDiagnostic,
} from "@/lib/dailyAdherence";
import { proteinSourceOf } from "@/lib/preferences";
import { resolveTarget, type DerivationStyle } from "@/lib/targetResolution";
import { generatedDiyCandidate, readyPlannerCatalog } from "@/lib/plannerCandidates";
import { quantitiesNearResidual } from "@/lib/diyQuantities";
import {
  componentFitsTemplate,
  templatesForSlot,
} from "@/lib/mealTemplates";
import {
  mealSlotPenalty,
  mealSlotEligibility,
  namedDishSlotPenalty,
  sectionSlotPenalty,
} from "@/lib/slotSuitability";
import {
  DEFAULT_PREFERENCES,
  type ClientPreferences,
  type Dish,
  type DishItem,
  type MacroTargets,
  type MacroStyle,
  type ProteinSource,
} from "@/lib/storage/types";

/**
 * Auto-planner: given daily macro targets, assemble meals that hit
 * them from what Negrita actually sells.
 *
 * Two candidate sources, as required:
 *  - COMPOSED  — built from DIY components (protein + carb + veg + fat), which
 *                is what the kitchen can assemble to order.
 *  - READY     — existing menu dishes and the user's own saved dishes, used whole.
 *
 * Everything is expressed in whole DIY portions, so the resulting price is the
 * real order cost rather than an estimate.
 */

export interface GeneratedMeal {
  slot: string;
  name: string;
  items: DishItem[];
  macros: Macros;
  price: PriceResult;
  /** Set when the meal is an existing saved dish or menu recipe. */
  sourceDishId?: string;
  kind: "composed" | "ready";
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
  /** Adherence is assessed once, from the complete day's totals. */
  adherence: DailyAdherenceDiagnostics;
}

export type { DailyAdherenceDiagnostics, MacroAdherenceDiagnostic };

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

/** A single DIY component option, already resolved to grams and price. */
interface Component {
  ingredient: Ingredient;
  portions: number;
  grams: number;
  macros: Macros;
  priceIdr: number;
  section: DiySection;
}

// --- scoring -----------------------------------------------------------------

/**
 * Distance from a macro target. Protein carries double weight because it is the
 * macro people actually hold themselves to; calories next; carbs and fat last,
 * since they are the ones that absorb the slack.
 */
const WEIGHTS = { protein: 2.0, energy: 1.2, carbs: 0.7, fat: 0.7 };

/**
 * Mild preference for cheaper ways to hit the same macros. Deliberately small:
 * it breaks ties toward affordable combinations without letting cost override
 * the actual targets. A Rp 200k meal carries a 0.3 penalty, which is
 * roughly the cost of being 15% off on protein.
 */
const PRICE_WEIGHT = 0.3;
const PRICE_REFERENCE_IDR = 200000;

function relative(actual: number, target: number): number {
  if (target <= 0) return actual > 0 ? 1 : 0;
  return Math.abs(actual - target) / target;
}

export function scoreAgainst(macros: Macros, target: MacroTargets): number {
  return (
    WEIGHTS.protein * relative(macros.protein_g, target.protein_g) +
    WEIGHTS.energy * relative(macros.energy_kcal, target.energy_kcal) +
    WEIGHTS.carbs * relative(macros.carbs_g, target.carbs_g) +
    WEIGHTS.fat * relative(macros.fat_g, target.fat_g)
  );
}

function pricePenalty(priceIdr: number): number {
  return PRICE_WEIGHT * (priceIdr / PRICE_REFERENCE_IDR);
}

/**
 * Not every protein on the menu can carry a meal. Tobiko (25 g), a single ham
 * slice and a 30 g anchovy are garnishes — pairing one with rice and calling it
 * dinner is arithmetically fine and culinarily nonsense. Anchors must be a real
 * portion and actually deliver protein; everything else can still join a meal
 * as an accent.
 */
const ANCHOR_MIN_PORTION_G = 60;
const ANCHOR_MIN_PROTEIN_G = 10;

/**
 * How strongly a leaned-toward protein is favoured. A bonus, never a filter:
 * "more fish" should tilt the week toward fish, not make everything else
 * ineligible and leave slots the planner cannot fill.
 */
const LEAN_BONUS = 0.45;

/**
 * How much of the repeat penalty a leaned-toward protein carries. Asking for
 * "more fish" should tolerate seeing fish more often, otherwise the repeat
 * penalty cancels the bonus after a single use and the lean barely registers —
 * which matters here because the DIY menu has only two fish items big enough to
 * anchor a meal, against nine meat ones.
 */
const LEAN_REPEAT_RELIEF = 0.4;

function leanBonus(
  ingredient: Ingredient,
  proteinLean: ProteinSource[]
): number {
  if (!proteinLean.length) return 0;
  const source = proteinSourceOf(ingredient);
  return source && proteinLean.includes(source) ? -LEAN_BONUS : 0;
}

function isAnchorProtein(component: Component): boolean {
  return (
    component.grams / component.portions >= ANCHOR_MIN_PORTION_G &&
    component.macros.protein_g / component.portions >= ANCHOR_MIN_PROTEIN_G
  );
}

/**
 * Share of the day a slot should carry. A snack or pre-workout is not a third
 * of someone's intake, and without this the planner cheerfully assigns a
 * 100 g steak as a "snack".
 */
function slotWeight(slot: string): number {
  const name = slot.toLowerCase();
  if (/snack|pre-?workout|post-?workout|shake/.test(name)) return 0.55;
  return 1;
}

// --- deterministic RNG -------------------------------------------------------

function makeRandom(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  let state = seed >>> 0 || 1;
  return () => {
    // xorshift32 — small, fast, and reproducible for tests.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

// --- component pool ----------------------------------------------------------

function buildComponents(section: DiySection, residual: MacroTargets): Component[] {
  const out: Component[] = [];
  const seen = new Set<string>();

  for (const item of diyMenu) {
    if (item.section !== section) continue;
    if (seen.has(item.ingredient_id)) continue;
    seen.add(item.ingredient_id);

    const ingredient = getIngredient(item.ingredient_id);
    if (!ingredient) continue;

    for (const grams of quantitiesNearResidual(ingredient, residual)) {
      const portions = Math.ceil(grams / item.portion_g);
      out.push({
        ingredient,
        portions,
        grams,
        macros: perItemMacros(ingredient, grams),
        priceIdr: item.price_idr * portions,
        section,
      });
    }
  }
  return out;
}

function toDishItem(component: Component): DishItem {
  return {
    ingredientId: component.ingredient.ingredient_id,
    name: component.ingredient.name,
    grams: component.grams,
    unitId: GRAM_UNIT_ID,
    quantity: component.grams,
  };
}

function remaining(target: MacroTargets, macros: Macros): MacroTargets {
  return {
    energy_kcal: target.energy_kcal - macros.energy_kcal,
    protein_g: target.protein_g - macros.protein_g,
    carbs_g: target.carbs_g - macros.carbs_g,
    fat_g: target.fat_g - macros.fat_g,
  };
}

// --- meal construction -------------------------------------------------------

interface Candidate extends PlannerCandidate {
  /** Output aliases retained at the planner boundary. */
  name: string;
  items: DishItem[];
  macros: Macros;
  priceIdr: number;
  score: number;
  slotPenalty: number;
  /** Whether this meal's protein is one the plan leans toward. */
  leaned: boolean;
  kind: "composed" | "ready";
  sourceDishId?: string;
}

/**
 * Builds composed-meal candidates for one meal target: enumerate protein × carb
 * (each at 1–2 portions), then greedily close the remaining gap with a veg and
 * a fat. Exhaustive over the pairing that matters, cheap over the rest.
 */
function composedCandidates(
  target: MacroTargets,
  slot: string,
  pools: Record<DiySection, Component[]>,
  budgetIdr: number | null,
  preferences: ClientPreferences
): Candidate[] {
  const out: Candidate[] = [];
  const avoid = preferences.avoidIngredientIds;
  const usable = (c: Component) => !avoid.includes(c.ingredient.ingredient_id);

  const anchors = pools.protein.filter((c) => isAnchorProtein(c) && usable(c));
  const accents = pools.protein.filter(
    (c) => !isAnchorProtein(c) && c.portions === 1 && usable(c)
  );

  // Templates bound the search twice: only slot-appropriate archetypes are
  // considered, and each archetype admits only realistic family/gram ranges.
  // The final per-template cap prevents portion flexibility from becoming a
  // protein × carb × vegetable × condiment Cartesian explosion.
  const templates = templatesForSlot(slot);
  const MAX_PER_TEMPLATE = 80;
  for (const mealTemplate of templates) {
    const templateStart = out.length;
    for (const protein of anchors) {
      if (!componentFitsTemplate(mealTemplate, protein.ingredient, protein.section, protein.grams)) continue;
      for (const carb of pools.carbs) {
        if (!usable(carb)) continue;
        if (!componentFitsTemplate(mealTemplate, carb.ingredient, carb.section, carb.grams)) continue;
        let macros = addMacros(protein.macros, carb.macros);
        let priceIdr = protein.priceIdr + carb.priceIdr;
        const parts: Component[] = [protein, carb];

      // Close the remaining gap: a vegetable, then a fat, then optionally a
      // small protein accent — each only if it genuinely improves the fit.
      const closers: Component[][] = [
        pools.veg.filter((c) => usable(c) && componentFitsTemplate(
          mealTemplate, c.ingredient, c.section, c.grams)),
        pools.fats.filter((c) => c.portions === 1 && usable(c) && componentFitsTemplate(
          mealTemplate, c.ingredient, c.section, c.grams)),
        accents.filter((c) => componentFitsTemplate(
          mealTemplate, c.ingredient, c.section, c.grams)),
      ];

      for (const [index, options] of closers.entries()) {
        const gap = remaining(target, macros);
        // Don't bolt on fats or accents when there is no room left.
        if (index > 0 && gap.energy_kcal < 60) continue;

        const current = scoreAgainst(macros, target) + pricePenalty(priceIdr);
        let best: Component | null = null;
        let bestScore = current;

        for (const option of options) {
          const candidateScore =
            scoreAgainst(addMacros(macros, option.macros), target) +
            pricePenalty(priceIdr + option.priceIdr);
          if (candidateScore < bestScore) {
            bestScore = candidateScore;
            best = option;
          }
        }

        if (best) {
          macros = addMacros(macros, best.macros);
          priceIdr += best.priceIdr;
          parts.push(best);
        }
      }

      if (mealTemplate.requiredRoles.includes("vegetable") &&
          !parts.some((part) => part.section === "veg")) continue;
      if (macros.energy_kcal < mealTemplate.mealSize.minKcal ||
          macros.energy_kcal > mealTemplate.mealSize.maxKcal) continue;

      if (budgetIdr !== null && priceIdr > budgetIdr) continue;

      const slotPenalty = mealSlotPenalty(
        parts.map((c) => c.ingredient.ingredient_id),
        slot
      );
      const name = `${mealTemplate.name}: ${protein.ingredient.diy_name ?? protein.ingredient.name} + ${
          carb.ingredient.diy_name ?? carb.ingredient.name
        }`;
      const items = parts.map(toDishItem);
      const normalized = generatedDiyCandidate({
        id: `${mealTemplate.id}:` + parts.map((part) =>
          `${part.ingredient.ingredient_id}:${part.grams}`).join("+"),
        name, items, macros, priceIdr,
      });
      normalized.mealArchetype = mealTemplate.id;
      normalized.eligibleMealTypes = mealTemplate.allowedSlots;
      const eligibility = mealSlotEligibility({ slot, name,
        mealArchetype: normalized.mealArchetype,
        eligibleMealTypes: normalized.eligibleMealTypes,
        ingredients: normalized.breakdown });
      if (!eligibility.allowed) continue;
      out.push({
        ...normalized,
        name,
        items,
        macros,
        priceIdr,
        score:
          scoreAgainst(macros, target) +
          pricePenalty(priceIdr),
        slotPenalty,
        leaned: leanBonus(protein.ingredient, preferences.proteinLean) < 0,
        kind: "composed",
      });
      if (out.length - templateStart >= MAX_PER_TEMPLATE) break;
      }
      if (out.length - templateStart >= MAX_PER_TEMPLATE) break;
    }
  }

  return out;
}

/** Menu recipes and saved dishes, scored whole. */
function readyCandidates(
  target: MacroTargets,
  slot: string,
  savedDishes: Dish[],
  menuDishes: boolean,
  budgetIdr: number | null,
  preferences: ClientPreferences,
  fixtures: PlannerCandidate[] = []
): Candidate[] {
  const out: Candidate[] = [];
  const avoid = preferences.avoidIngredientIds;
  const hasAvoided = (items: DishItem[]) =>
    items.some((i) => avoid.includes(i.ingredientId));

  for (const normalized of [...readyPlannerCatalog(savedDishes, menuDishes), ...fixtures]) {
    const eligibility = mealSlotEligibility({ slot, name: normalized.displayName,
      mealArchetype: normalized.mealArchetype,
      eligibleMealTypes: normalized.eligibleMealTypes,
      ingredients: normalized.breakdown });
    if (!eligibility.allowed) continue;
    const items: DishItem[] = normalized.breakdown.map((item) => ({
      ingredientId: item.ingredientId, name: item.name, grams: item.grams,
      unitId: GRAM_UNIT_ID, quantity: item.grams,
    }));
    if (hasAvoided(items)) continue;
    const macros = normalized.optimizerMacros;
    const price = normalized.price;
    // An incompletely priced dish has an unknown true cost, so it cannot be
    // shown to fit a budget. Treating its partial total as the real price let a
    // Rp 40,000 "minimum" smuggle a 1,218 kcal dish into a snack slot.
    if (budgetIdr !== null && (!price.complete || price.totalIdr > budgetIdr)) {
      continue;
    }
    const recipeSection = normalized.source === "negrita_menu"
      ? menuRecipesSection(normalized.id.slice("menu:".length)) : null;
    const slotPenalty = recipeSection
      ? sectionSlotPenalty(recipeSection, slot) ?? namedDishSlotPenalty(normalized.displayName, slot)
      : namedDishSlotPenalty(normalized.displayName, slot);
    out.push({
      ...normalized,
      name: normalized.displayName,
      items,
      macros,
      priceIdr: price.totalIdr,
      score:
        scoreAgainst(macros, target),
      slotPenalty,
      leaned: false,
      kind: "ready",
      sourceDishId: normalized.source === "saved_dish" ? normalized.id.slice("saved:".length) : undefined,
    });
  }

  return out;
}

function menuRecipesSection(recipeId: string): string | null {
  return menuRecipes.find((recipe) => recipe.recipe_id === recipeId)?.section ?? null;
}

// --- generation --------------------------------------------------------------

/** Maximum number of partial complete-day plans retained at each depth. */
const BEAM_WIDTH = 160;
/**
 * Complete days closer than this are operationally equivalent. The error is
 * already normalized by each macro's daily tolerance, so 0.1 is only one tenth
 * of a tolerance unit on the four-macro average.
 */
export const COMPLETE_DAY_ERROR_EQUIVALENCE = 0.1;

/** Floating-point noise must not turn equal secondary scores into preference. */
const SECONDARY_SCORE_EQUIVALENCE = 1e-9;
/**
 * Repeat penalties, applied per previous use in the week. Tiered so the exact
 * same meal is discouraged hardest, then the protein, then the carbohydrate —
 * without the carb tier a single rice or potato quietly runs the whole week.
 */
const REPEAT_PENALTY = {
  exactDishIdentity: 1.2,
  proteinFamily: 0.45,
  carbFamily: 0.3,
  cuisineFamily: 0.2,
  sauceFamilies: 0.2,
  mealArchetype: 0.15,
} as const;

type VarietyDimension = keyof typeof REPEAT_PENALTY;
export type WeeklyVarietyUsage = Record<VarietyDimension, Map<string, number>>;

/** Source-independent counters: every candidate is measured by normalized metadata. */
export function createWeeklyVarietyUsage(): WeeklyVarietyUsage {
  return {
    exactDishIdentity: new Map(), proteinFamily: new Map(), carbFamily: new Map(),
    cuisineFamily: new Map(), sauceFamilies: new Map(), mealArchetype: new Map(),
  };
}

function varietyValues(candidate: PlannerCandidate, dimension: VarietyDimension): string[] {
  const value = candidate[dimension];
  return Array.isArray(value) ? value : [value];
}

export function recordWeeklyVariety(
  usage: WeeklyVarietyUsage,
  candidate: PlannerCandidate
): void {
  for (const dimension of Object.keys(REPEAT_PENALTY) as VarietyDimension[]) {
    for (const value of varietyValues(candidate, dimension)) {
      usage[dimension].set(value, (usage[dimension].get(value) ?? 0) + 1);
    }
  }
}

/**
 * Consecutive recurrence is an additional two base penalties, so it is always
 * costlier than the same historical recurrence with a day between uses.
 */
function weeklyVarietyPenalty(candidate: Candidate, usage: WeeklyVarietyUsage,
  previousDay: WeeklyVarietyUsage): number {
  let penalty = 0;
  for (const dimension of Object.keys(REPEAT_PENALTY) as VarietyDimension[]) {
    const leanRelief = dimension === "proteinFamily" && candidate.leaned
      ? LEAN_REPEAT_RELIEF : 1;
    for (const value of varietyValues(candidate, dimension)) {
      const weight = REPEAT_PENALTY[dimension] * leanRelief;
      penalty += weight * (usage[dimension].get(value) ?? 0);
      if (previousDay[dimension].has(value)) penalty += weight * 2;
    }
  }
  return penalty;
}

interface SearchState {
  candidates: Candidate[];
  macros: Macros;
  priceIdr: number;
  score: number;
  softScore: number;
}

export function generatePlan(options: GenerateOptions): GeneratedDay[] {
  const resolvedTargets = resolveTarget({
    targets: options.targets,
    style: options.targetStyle ?? options.preferences?.macroStyle,
  }).target;
  const random = makeRandom(options.seed);

  const preferences = options.preferences ?? DEFAULT_PREFERENCES;
  const slots = options.slots.length ? options.slots : ["Meal"];

  // Split the day by slot weight rather than evenly, so a snack stays a snack.
  const weights = slots.map(slotWeight);
  const weightTotal = weights.reduce((a, b) => a + b, 0) || 1;

  const slotPlans = slots.map((slot, index) => {
    const share = weights[index] / weightTotal;
    const target: MacroTargets = {
      energy_kcal: resolvedTargets.energy_kcal * share,
      protein_g: resolvedTargets.protein_g * share,
      carbs_g: resolvedTargets.carbs_g * share,
      fat_g: resolvedTargets.fat_g * share,
    };
    // Each ingredient contributes only the snapped optimum and its immediate
    // neighbors for this residual, rather than its entire permitted range.
    const pools: Record<DiySection, Component[]> = {
      carbs: buildComponents("carbs", target),
      protein: buildComponents("protein", target),
      veg: buildComponents("veg", target),
      fats: buildComponents("fats", target),
    };
    const budget =
      options.dailyBudgetIdr && options.dailyBudgetIdr > 0
        ? options.dailyBudgetIdr
        : null;

    // Candidates are built per slot because the target differs by slot, then
    // reused across all days; only the repeat penalty changes day to day.
    return {
      slot,
      target,
      pool: [
        ...(options.includeComposed === false
          ? [] : composedCandidates(target, slot, pools, budget, preferences)),
        ...readyCandidates(
          target,
          slot,
          options.includeSavedDishes ? options.savedDishes : [],
          options.includeMenuDishes,
          budget,
          preferences,
          options.candidateFixtures
        ),
      ],
    };
  });

  const usage = createWeeklyVarietyUsage();
  let previousDay = createWeeklyVarietyUsage();
  const days: GeneratedDay[] = [];

  for (const day of options.days) {
    const fillable = slotPlans.filter(({ pool }) => pool.length);
    const unfilledSlots = slotPlans.filter(({ pool }) => !pool.length).map(({ slot }) => slot);
    let beam: SearchState[] = [{
      candidates: [], macros: { ...EMPTY_MACROS }, priceIdr: 0,
      score: 0, softScore: 0,
    }];

    for (let index = 0; index < fillable.length; index += 1) {
      const { pool } = fillable[index];
      const slotsLeft = fillable.length - index;
      const expanded: SearchState[] = [];
      for (const state of beam) {
        const residual = remaining(resolvedTargets, state.macros);
        const nextTarget: MacroTargets = {
          energy_kcal: residual.energy_kcal / slotsLeft,
          protein_g: residual.protein_g / slotsLeft,
          carbs_g: residual.carbs_g / slotsLeft,
          fat_g: residual.fat_g / slotsLeft,
        };
        for (const candidate of pool) {
          const priceIdr = state.priceIdr + candidate.priceIdr;
          if (options.dailyBudgetIdr && priceIdr > options.dailyBudgetIdr) continue;
          const macros = addMacros(state.macros, candidate.macros);
          const repeat = weeklyVarietyPenalty(candidate, usage, previousDay);
          // The residual supplies the target for this tentative choice; the
          // complete-day distance keeps compensation, rather than slot fit,
          // authoritative. Beam pruning is deliberately deterministic.
          const score = scoreAgainst(macros, resolvedTargets) +
            scoreAgainst(candidate.macros, nextTarget) / slotsLeft +
            // Custom meals are scored against the *current daily residual*, not
            // the slot's initial allocation. A template's serving envelope is
            // the only per-meal size constraint, allowing the optimizer to
            // compensate with a smaller or larger appropriate meal. Culinary
            // suitability is considered in `softScore` below.
            pricePenalty(priceIdr);
          expanded.push({
            candidates: [...state.candidates, candidate], macros, priceIdr,
            score,
            softScore: state.softScore + candidate.slotPenalty +
              (candidate.readyMadePriority === "high" ? -0.3 : 0) +
              (candidate.leaned ? -LEAN_BONUS : 0) + repeat +
              pricePenalty(candidate.priceIdr),
          });
        }
      }
      beam = expanded.sort((a, b) => a.score - b.score).slice(0, BEAM_WIDTH);
    }

    // Classify every complete-day solution before any random choice. Exact,
    // within-tolerance, and best-effort are deliberately separate classes: a
    // seed can therefore vary composition, but can never demote adherence.
    const classified = beam.map((state) => ({
      state,
      diagnostics: diagnoseDailyAdherence(state.macros, resolvedTargets),
    }));
    const adherenceRank = { Exact: 0, "Within tolerance": 1, "Best effort": 2,
      Impossible: 3 } as const;
    const bestRank = classified.reduce(
      (best, item) => Math.min(best, adherenceRank[item.diagnostics.classification]),
      Number.POSITIVE_INFINITY
    );
    const bestClass = classified.filter(
      (item) => adherenceRank[item.diagnostics.classification] === bestRank
    );
    const bestError = bestClass.reduce(
      (best, item) => Math.min(best, item.diagnostics.normalizedError),
      Number.POSITIVE_INFINITY
    );
    // Macro adherence remains authoritative. Only days whose normalized error
    // is effectively tied may compete on variety, preferences, suitability,
    // and price (all represented by softScore).
    const macroTiePool = bestClass.filter(
      (item) => item.diagnostics.normalizedError <=
        bestError + COMPLETE_DAY_ERROR_EQUIVALENCE
    );
    const bestSoftScore = macroTiePool.reduce(
      (best, item) => Math.min(best, item.state.softScore),
      Number.POSITIVE_INFINITY
    );
    const finalTiePool = macroTiePool.filter(
      (item) => item.state.softScore <=
        bestSoftScore + SECONDARY_SCORE_EQUIVALENCE
    );
    // Randomness is a final tie-breaker only. No random value participates in
    // candidate generation, beam pruning, adherence, or secondary scoring.
    const selected = finalTiePool.length > 1
      ? finalTiePool[Math.floor(random() * finalTiePool.length)]
      : finalTiePool[0];
    const complete = selected?.state;
    const meals: GeneratedMeal[] = [];
    const dayMacros: Macros = complete?.macros ?? { ...EMPTY_MACROS };
    let dayPrice: PriceResult = { ...ZERO_PRICE };

    for (const [index, candidate] of (complete?.candidates ?? []).entries()) {
      recordWeeklyVariety(usage, candidate);

      const price =
        candidate.kind === "ready" && candidate.priceIdr > 0
          ? { ...ZERO_PRICE, totalIdr: candidate.priceIdr }
          : priceItems(candidate.items);

      meals.push({
        slot: fillable[index].slot,
        name: candidate.name,
        items: candidate.items,
        macros: candidate.macros,
        price,
        kind: candidate.kind,
        sourceDishId: candidate.sourceDishId,
      });
      dayPrice = addPrices(dayPrice, price);
    }

    days.push({
      day, meals, macros: dayMacros, price: dayPrice, unfilledSlots,
      adherence: diagnoseDailyAdherence(dayMacros, resolvedTargets, {
        complete: Boolean(complete) && unfilledSlots.length === 0,
        restrictionsApplied: preferences.avoidIngredientIds.length > 0,
        unavailableSlots: unfilledSlots,
        kitchenPortionsConstrained: Boolean(complete?.candidates.some(
          (candidate) => candidate.kind === "composed"
        )),
      }),
    });
    previousDay = createWeeklyVarietyUsage();
    for (const candidate of complete?.candidates ?? []) {
      recordWeeklyVariety(previousDay, candidate);
    }
  }

  return days;
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
