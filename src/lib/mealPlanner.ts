import type { DiySection, Ingredient, Macros } from "@/types/nutrition";
import { GRAM_UNIT_ID } from "@/types/nutrition";
import { diyMenu, getIngredient, menuRecipes } from "@/lib/database";
import { EMPTY_MACROS, addMacros, perItemMacros, sumDishMacros } from "@/lib/calc";
import { priceItems, type PriceResult } from "@/lib/pricing";
import type { Dish, DishItem, MacroTargets } from "@/lib/storage/types";

/**
 * Auto-planner: given a coach's daily macro targets, assemble meals that hit
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
   * than silently padded, so the coach knows the budget (not the menu) is what
   * kept the day short.
   */
  unfilledSlots: string[];
}

export interface GenerateOptions {
  targets: MacroTargets;
  slots: string[];
  /** Include the 25 Negrita menu dishes and saved dishes as whole-meal options. */
  includeReadyDishes: boolean;
  /** Saved dishes available as ready meals. */
  savedDishes: Dish[];
  /** Optional ceiling on a single day's food cost, in rupiah. */
  dailyBudgetIdr?: number | null;
  /** Days to generate (0 = Monday). */
  days: number[];
  /** Deterministic output when set, for testing. */
  seed?: number;
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
 * macro a coach actually holds a client to; calories next; carbs and fat last,
 * since they are the ones that absorb the slack.
 */
const WEIGHTS = { protein: 2.0, energy: 1.2, carbs: 0.7, fat: 0.7 };

/**
 * Mild preference for cheaper ways to hit the same macros. Deliberately small:
 * it breaks ties toward affordable combinations without letting cost override
 * the coach's actual targets. A Rp 200k meal carries a 0.3 penalty, which is
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
    return state / 0xffffffff;
  };
}

// --- component pool ----------------------------------------------------------

/** Portion multipliers considered per component. */
const MULTIPLIERS = [1, 2];

function buildComponents(section: DiySection): Component[] {
  const out: Component[] = [];
  const seen = new Set<string>();

  for (const item of diyMenu) {
    if (item.section !== section) continue;
    if (seen.has(item.ingredient_id)) continue;
    seen.add(item.ingredient_id);

    const ingredient = getIngredient(item.ingredient_id);
    if (!ingredient) continue;

    for (const multiplier of MULTIPLIERS) {
      const grams = item.portion_g * multiplier;
      out.push({
        ingredient,
        portions: multiplier,
        grams,
        macros: perItemMacros(ingredient, grams),
        priceIdr: item.price_idr * multiplier,
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
    energy_kcal: Math.max(0, target.energy_kcal - macros.energy_kcal),
    protein_g: Math.max(0, target.protein_g - macros.protein_g),
    carbs_g: Math.max(0, target.carbs_g - macros.carbs_g),
    fat_g: Math.max(0, target.fat_g - macros.fat_g),
  };
}

// --- meal construction -------------------------------------------------------

interface Candidate {
  name: string;
  items: DishItem[];
  macros: Macros;
  priceIdr: number;
  score: number;
  proteinKey: string;
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
  pools: Record<DiySection, Component[]>,
  budgetIdr: number | null
): Candidate[] {
  const out: Candidate[] = [];
  const anchors = pools.protein.filter(isAnchorProtein);
  const accents = pools.protein.filter((c) => !isAnchorProtein(c) && c.portions === 1);

  for (const protein of anchors) {
    for (const carb of pools.carbs) {
      let macros = addMacros(protein.macros, carb.macros);
      let priceIdr = protein.priceIdr + carb.priceIdr;
      const parts: Component[] = [protein, carb];

      // Close the remaining gap: a vegetable, then a fat, then optionally a
      // small protein accent — each only if it genuinely improves the fit.
      const closers: Component[][] = [
        pools.veg,
        pools.fats.filter((c) => c.portions === 1),
        accents,
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

      if (budgetIdr !== null && priceIdr > budgetIdr) continue;

      out.push({
        name: `${protein.ingredient.diy_name ?? protein.ingredient.name} + ${
          carb.ingredient.diy_name ?? carb.ingredient.name
        }`,
        items: parts.map(toDishItem),
        macros,
        priceIdr,
        score: scoreAgainst(macros, target) + pricePenalty(priceIdr),
        proteinKey: protein.ingredient.ingredient_id,
        kind: "composed",
      });
    }
  }

  return out;
}

/** Menu recipes and saved dishes, scored whole. */
function readyCandidates(
  target: MacroTargets,
  savedDishes: Dish[],
  budgetIdr: number | null
): Candidate[] {
  const out: Candidate[] = [];

  for (const dish of savedDishes) {
    const macros = sumDishMacros(dish.items);
    if (macros.energy_kcal <= 0) continue;
    const price = priceItems(dish.items);
    // An incompletely priced dish has an unknown true cost, so it cannot be
    // shown to fit a budget. Treating its partial total as the real price let a
    // Rp 40,000 "minimum" smuggle a 1,218 kcal dish into a snack slot.
    if (budgetIdr !== null && (!price.complete || price.totalIdr > budgetIdr)) {
      continue;
    }
    out.push({
      name: dish.name,
      items: dish.items,
      macros,
      priceIdr: price.totalIdr,
      score: scoreAgainst(macros, target),
      proteinKey: `dish:${dish.id}`,
      kind: "ready",
      sourceDishId: dish.id,
    });
  }

  for (const recipe of menuRecipes) {
    const items: DishItem[] = [];
    for (const component of recipe.components) {
      const ingredient = getIngredient(component.ingredient_id);
      if (!ingredient || !component.quantity_g) continue;
      items.push({
        ingredientId: component.ingredient_id,
        name: ingredient.name,
        grams: component.quantity_g,
        unitId: GRAM_UNIT_ID,
        quantity: component.quantity_g,
      });
    }
    if (!items.length) continue;
    const macros = sumDishMacros(items);
    // Menu dishes carry their own price; that is the real order cost.
    const priceIdr = recipe.price_idr ?? 0;
    if (budgetIdr !== null && priceIdr > budgetIdr) continue;
    out.push({
      name: recipe.name,
      items,
      macros,
      priceIdr,
      score: scoreAgainst(macros, target),
      proteinKey: `recipe:${recipe.recipe_id}`,
      kind: "ready",
    });
  }

  return out;
}

// --- generation --------------------------------------------------------------

/** How many top candidates to randomise between, for variety across a week. */
const TOP_K = 8;
/** Score penalty applied per previous use of the same protein in the week. */
const REPEAT_PENALTY = 0.35;
/**
 * A meal must be recognisably the size the slot asked for. Without this, a slot
 * whose candidates were all filtered out (by a tight budget, say) would accept
 * whatever single option remained — which is how a 1,218 kcal dish once landed
 * in a 265 kcal snack. Better to leave the slot empty and say so.
 */
const MAX_ENERGY_RATIO = 1.8;
const MIN_ENERGY_RATIO = 0.35;

export function generatePlan(options: GenerateOptions): GeneratedDay[] {
  const random = makeRandom(options.seed);
  const pools: Record<DiySection, Component[]> = {
    carbs: buildComponents("carbs"),
    protein: buildComponents("protein"),
    veg: buildComponents("veg"),
    fats: buildComponents("fats"),
  };

  const slots = options.slots.length ? options.slots : ["Meal"];

  // Split the day by slot weight rather than evenly, so a snack stays a snack.
  const weights = slots.map(slotWeight);
  const weightTotal = weights.reduce((a, b) => a + b, 0) || 1;

  const slotPlans = slots.map((slot, index) => {
    const share = weights[index] / weightTotal;
    const target: MacroTargets = {
      energy_kcal: options.targets.energy_kcal * share,
      protein_g: options.targets.protein_g * share,
      carbs_g: options.targets.carbs_g * share,
      fat_g: options.targets.fat_g * share,
    };
    const budget =
      options.dailyBudgetIdr && options.dailyBudgetIdr > 0
        ? options.dailyBudgetIdr * share
        : null;

    // Candidates are built per slot because the target differs by slot, then
    // reused across all days; only the repeat penalty changes day to day.
    return {
      slot,
      target,
      pool: [
        ...composedCandidates(target, pools, budget),
        ...(options.includeReadyDishes
          ? readyCandidates(target, options.savedDishes, budget)
          : []),
      ],
    };
  });

  const usage = new Map<string, number>();
  const days: GeneratedDay[] = [];

  for (const day of options.days) {
    const meals: GeneratedMeal[] = [];
    const unfilledSlots: string[] = [];
    let dayMacros: Macros = { ...EMPTY_MACROS };
    let dayPrice: PriceResult = {
      totalIdr: 0,
      unpricedCount: 0,
      complete: true,
    };

    for (const { slot, target, pool } of slotPlans) {
      if (!pool.length) {
        unfilledSlots.push(slot);
        continue;
      }

      // Re-score with a penalty for proteins already used this week, so the
      // seven days don't come back identical.
      const ranked = pool
        .filter((candidate) => {
          if (target.energy_kcal <= 0) return true;
          const ratio = candidate.macros.energy_kcal / target.energy_kcal;
          return ratio <= MAX_ENERGY_RATIO && ratio >= MIN_ENERGY_RATIO;
        })
        .map((candidate) => ({
          candidate,
          adjusted:
            candidate.score +
            REPEAT_PENALTY * (usage.get(candidate.proteinKey) ?? 0),
        }))
        .sort((a, b) => a.adjusted - b.adjusted)
        .slice(0, TOP_K);

      // Nothing sensible fits this slot — leave it empty rather than assign
      // something the coach would have to undo.
      if (!ranked.length) {
        unfilledSlots.push(slot);
        continue;
      }

      const picked = ranked[Math.floor(random() * ranked.length)] ?? ranked[0];

      const candidate = picked.candidate;
      usage.set(
        candidate.proteinKey,
        (usage.get(candidate.proteinKey) ?? 0) + 1
      );

      const price =
        candidate.kind === "ready" && candidate.priceIdr > 0
          ? { totalIdr: candidate.priceIdr, unpricedCount: 0, complete: true }
          : priceItems(candidate.items);

      meals.push({
        slot,
        name: candidate.name,
        items: candidate.items,
        macros: candidate.macros,
        price,
        kind: candidate.kind,
        sourceDishId: candidate.sourceDishId,
      });

      dayMacros = addMacros(dayMacros, candidate.macros);
      dayPrice = {
        totalIdr: dayPrice.totalIdr + price.totalIdr,
        unpricedCount: dayPrice.unpricedCount + price.unpricedCount,
        complete: dayPrice.complete && price.complete,
      };
    }

    days.push({ day, meals, macros: dayMacros, price: dayPrice, unfilledSlots });
  }

  return days;
}

/** How far a generated day lands from target, for showing accuracy in the UI. */
export function dayAccuracy(
  macros: Macros,
  targets: MacroTargets
): { key: string; label: string; actual: number; target: number; pct: number }[] {
  return [
    { key: "energy_kcal", label: "Calories", actual: macros.energy_kcal, target: targets.energy_kcal },
    { key: "protein_g", label: "Protein", actual: macros.protein_g, target: targets.protein_g },
    { key: "carbs_g", label: "Carbs", actual: macros.carbs_g, target: targets.carbs_g },
    { key: "fat_g", label: "Fat", actual: macros.fat_g, target: targets.fat_g },
  ].map((row) => ({
    ...row,
    pct: row.target > 0 ? (row.actual / row.target) * 100 : 0,
  }));
}
