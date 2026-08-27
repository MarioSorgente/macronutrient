import { getIngredient } from "@/lib/database";
import { perItemMacros } from "@/lib/calc";

/**
 * What a dish is, and when it may be eaten.
 *
 * This used to live in five places that disagreed: the curated menu table, a
 * regex in `plannerCandidates`, `SECTION_KIND` and four word lists in
 * `slotSuitability`, and the ingredient sets beside them. The two that mattered
 * had drifted apart — `BREAKFASTY_WORDS` knew "banana bread" while the regex
 * that actually decided eligibility did not — so a saved Protein Banana Bread
 * was classified a main, offered for lunch, and *barred* from breakfast. One
 * vocabulary, consumed by all of them, is what stops that recurring.
 */

export type MealTime =
  | "breakfast"
  | "lunch"
  | "dinner"
  | "snack"
  | "pre-workout"
  | "post-workout";

/** What kind of dish this is, independent of who eats it when. */
export type DishCourse = "sweet" | "breakfast-savoury" | "main" | "snack";

/**
 * Ingredients that make a dish a dessert on their own.
 *
 * These are dish-defining rather than seasoning: nothing at Negrita contains a
 * waffle base or Negrita's own banana bread loaf as a garnish, so their presence
 * settles the question without weighing anything.
 */
const SWEET_ANCHORS = new Set([
  "banana_bread_negrita",
  "syrniki_negrita",
  "pancake_base_prepared_proxy",
  "waffle_base_prepared_proxy",
  "berry_compote_stevia_proxy",
  "ice_cream_generic",
  "ice_cream_vanilla",
]);

/** Ingredient categories that read as sweet when they dominate a plate. */
const SWEET_CATEGORIES = new Set(["dessert", "sweetener", "fruit"]);

/** Sweet by category, but savoury often enough that they need the whole dish. */
const SAVOURY_FRUIT = new Set(["avocado_raw", "lime_raw_proxy", "tomato_cherry_raw"]);

/**
 * The single sweet vocabulary. Previously duplicated, in two versions, as
 * `BREAKFASTY_WORDS` in slotSuitability and the `mealMetadata` regex in
 * plannerCandidates — only the weaker of the two gated anything.
 */
const SWEET_WORDS =
  /pancake|waffle|banana bread|cheese ?cake|syrniki|cr[êe]pe|muffin|brownie|cookie|granola|oatmeal|porridge|oats|a[çc]a[íi]|compote|ice cream|dessert|pastry|donut|doughnut|french toast/i;

/** Savoury dishes that still belong at breakfast — and are fine at a main slot. */
const BREAKFAST_SAVOURY_WORDS =
  /breakfast|omelet|omelette|scrambl|benedict|shakshuka|frittata|bacon|hash brown|congee|full english/i;

const SNACK_WORDS = /snack|shake|smoothie|protein bar/i;

/**
 * Share of a dish's energy that has to be sweet before the dish is one.
 *
 * Presence is not enough. Twenty grams of honey on grilled chicken is a glaze,
 * and banning that plate from dinner because it contains a sweetener would be
 * the same category error in the opposite direction.
 */
const SWEET_ENERGY_SHARE = 0.5;

export interface CourseInput {
  name: string;
  /** `MenuRecipe.section`, when the dish came from the Negrita menu. */
  section?: string;
  ingredients?: { ingredientId: string; name?: string; grams?: number }[];
}

function sweetEnergyShare(
  ingredients: NonNullable<CourseInput["ingredients"]>
): number {
  let sweet = 0;
  let total = 0;
  for (const item of ingredients) {
    const ingredient = getIngredient(item.ingredientId);
    if (!ingredient) continue;
    const energy = perItemMacros(ingredient, item.grams ?? 0).energy_kcal;
    if (energy <= 0) continue;
    total += energy;
    if (
      SWEET_CATEGORIES.has(ingredient.category) &&
      !SAVOURY_FRUIT.has(item.ingredientId)
    ) {
      sweet += energy;
    }
  }
  return total > 0 ? sweet / total : 0;
}

/**
 * What kind of dish this is.
 *
 * Ordered by how much the evidence is worth: the restaurant's own filing beats
 * an ingredient that can only mean dessert, which beats the dish's name, which
 * beats weighing the plate up.
 */
export function classifyCourse(input: CourseInput): DishCourse {
  if (input.section === "breakfast_and_sweets") return "sweet";

  const ingredients = input.ingredients ?? [];
  if (ingredients.some((item) => SWEET_ANCHORS.has(item.ingredientId))) {
    return "sweet";
  }

  const text = `${input.name} ${input.section ?? ""}`.toLowerCase();
  if (SWEET_WORDS.test(text)) return "sweet";
  if (BREAKFAST_SAVOURY_WORDS.test(text)) return "breakfast-savoury";
  if (SNACK_WORDS.test(text)) return "snack";

  if (ingredients.length && sweetEnergyShare(ingredients) >= SWEET_ENERGY_SHARE) {
    return "sweet";
  }

  return "main";
}

/**
 * When a course may be served.
 *
 * Sweets are breakfast and brunch only — not lunch, not dinner, and not the
 * snack slot either. A savoury breakfast is unrestricted: a breakfast burrito at
 * dinner is unremarkable in a way a waffle is not.
 */
export function mealTimesForCourse(course: DishCourse): MealTime[] {
  switch (course) {
    case "sweet":
      return ["breakfast"];
    case "breakfast-savoury":
      return ["breakfast", "lunch", "dinner"];
    case "snack":
      return ["snack", "pre-workout", "post-workout"];
    case "main":
    default:
      return ["lunch", "dinner"];
  }
}

/** The archetype name the planner uses for variety accounting. */
export function archetypeForCourse(course: DishCourse): string {
  return course === "sweet" || course === "breakfast-savoury"
    ? "breakfast"
    : course === "snack"
      ? "snack"
      : "main";
}

// --- slots -------------------------------------------------------------------

export type SlotKind = "breakfast" | "main" | "snack";

const BREAKFAST_SLOT = /breakfast|brunch|morning|colazione/;
const SNACK_SLOT = /snack|shake|pre-?workout|post-?workout|dessert|spuntino/;
const LUNCH_SLOT = /lunch|midday|noon|pranzo/;
const DINNER_SLOT = /dinner|supper|evening|cena/;

export interface SlotProfile {
  slot: string;
  mealTime: MealTime;
  kind: SlotKind;
  /** True when the meal time was inferred from position rather than the name. */
  inferred: boolean;
  /**
   * Nothing is out of place here, so hard eligibility is skipped.
   *
   * A plan with one unnamed slot has that slot standing for the whole day.
   * There is no wrong time of day to be wrong about, and refusing a dish would
   * leave the only slot empty.
   */
  unrestricted: boolean;
}

export function namedMealTime(slot: string): MealTime | null {
  const name = slot.toLowerCase();
  if (BREAKFAST_SLOT.test(name)) return "breakfast";
  if (/pre-?workout/.test(name)) return "pre-workout";
  if (/post-?workout/.test(name)) return "post-workout";
  if (SNACK_SLOT.test(name)) return "snack";
  if (LUNCH_SLOT.test(name)) return "lunch";
  if (DINNER_SLOT.test(name)) return "dinner";
  return null;
}

/**
 * Slot kind from the name alone, for call sites with no position to hand
 * (the week grid, the plan report, order building). Unknown names read as a
 * main, which is what they have always done.
 */
export function slotKindOf(slot: string): SlotKind {
  const named = namedMealTime(slot);
  return named ? kindOfMealTime(named) : "main";
}

export function kindOfMealTime(mealTime: MealTime): SlotKind {
  if (mealTime === "breakfast") return "breakfast";
  if (mealTime === "lunch" || mealTime === "dinner") return "main";
  return "snack";
}

/**
 * What time of day a slot represents.
 *
 * Slot names are free text — people rename them, and not always into English.
 * Falling back to "dinner" for anything unrecognised was the worst of both
 * outcomes: a slot called "Meal 1" admitted every dinner main *and* barred every
 * breakfast dish. Position is the better guess, because a plan's slots are
 * listed in the order they are eaten: the first of three or more is breakfast
 * and the last is dinner. A single slot is left unrestricted, since it stands
 * for the whole day.
 */
export function resolveSlotTime(
  slot: string,
  index: number,
  total: number
): SlotProfile {
  const named = namedMealTime(slot);
  if (named) {
    return { slot, mealTime: named, kind: kindOfMealTime(named), inferred: false,
      unrestricted: false };
  }

  const mealTime: MealTime =
    total <= 1
      ? "lunch"
      : index === 0
        ? "breakfast"
        : index === total - 1
          ? "dinner"
          : "lunch";
  return {
    slot,
    mealTime,
    kind: kindOfMealTime(mealTime),
    inferred: true,
    unrestricted: total <= 1,
  };
}

/** Resolve every slot in a day together, so position is available. */
export function resolveSlotProfiles(slots: string[]): SlotProfile[] {
  return slots.map((slot, index) => resolveSlotTime(slot, index, slots.length));
}
