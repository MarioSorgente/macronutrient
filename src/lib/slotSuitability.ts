/**
 * Whether a food belongs at a given time of day.
 *
 * The planner already gets the arithmetic right — a saucy peri peri chicken can
 * hit a breakfast macro target perfectly well. It is still the wrong answer at
 * eight in the morning, and a plan full of technically-correct nonsense is one
 * nobody follows.
 *
 * This is a *bias*, in keeping with how preferences work everywhere else in the
 * planner: a strong penalty rather than a filter, so an unusual choice is
 * avoided when there is an alternative but a slot is never left empty purely
 * for being unconventional.
 *
 * Bali matters here. Rice, eggs and sambal at breakfast are entirely normal
 * locally, so the rule is about *heaviness and sauciness*, not about imposing a
 * European breakfast. Rice and sweet potato stay neutral.
 */

export type SlotKind = "breakfast" | "main" | "snack";

/** Stable, machine-readable outcomes for hard slot eligibility. */
export type SlotEligibilityReason =
  | "ELIGIBLE_CLASSIFIED_SLOT"
  | "ELIGIBLE_COMPATIBLE_INGREDIENTS"
  | "ELIGIBLE_NAME_FALLBACK"
  | "INELIGIBLE_CLASSIFIED_SLOT"
  | "INELIGIBLE_BREAKFAST_MAIN"
  | "INELIGIBLE_HEAVY_SNACK"
  | "INELIGIBLE_UNRECOGNIZED";

export interface SlotEligibilityResult {
  allowed: boolean;
  reason: SlotEligibilityReason;
  explanation?: string;
}

export interface SlotEligibilityInput {
  slot: string;
  name?: string;
  /** Normalized/curated classification, when the catalog has one. */
  mealArchetype?: string;
  eligibleMealTypes?: string[];
  ingredients?: Array<{ ingredientId: string; name?: string; grams?: number }>;
}

export function slotKindOf(slot: string): SlotKind {
  const name = slot.toLowerCase();
  if (/breakfast|brunch|morning/.test(name)) return "breakfast";
  if (/snack|shake|pre-?workout|post-?workout|dessert/.test(name)) return "snack";
  return "main";
}

/**
 * Things people genuinely eat in the morning: eggs, cured and smoked things,
 * bread, yogurt, fruit, avocado, cheese.
 */
const BREAKFAST_FRIENDLY = new Set([
  // protein
  "egg_whole_hard_boiled",
  "bacon_streaky",
  "ham_sliced",
  "salmon_smoked",
  "sausage_chicken",
  "sausage_beef",
  // carbs
  "bread_sourdough",
  "bread_brioche",
  "hash_brown",
  "honey",
  "baked_beans",
  "buckwheat_cooked",
  "quinoa_cooked",
  "paratha_wholewheat",
  "sweet_potato_baked",
  // fats
  "greek_yogurt_nonfat",
  "avocado_raw",
  "cheese_cream",
  "cheese_cottage_lowfat",
  "cheese_halloumi",
  "cheese_feta",
  // veg and fruit
  "tomato_cherry_raw",
  "mushrooms_white_proxy",
  "banana_raw",
  "watermelon_raw",
  "iceberg_or_mixed_lettuce",
]);

/**
 * Dinner food. Cooked-to-order mains and anything built around a sauce — the
 * category the "peri peri chicken at breakfast" complaint was about.
 */
const DINNER_ONLY = new Set([
  "chicken_peri_peri_negrita",
  "chicken_teriyaki_negrita",
  "chicken_mushroom_negrita",
  "chicken_breast_raw",
  "beef_tenderloin_raw",
  "salmon_atlantic_raw",
  "wagyu_ground_raw_proxy",
  "anchovy_garlic_butter",
  "tzatziki_proxy",
  "hummus",
  "pickled_ginger",
  "beetroot_cooked",
  "broccoli_boiled",
  "grilled_mixed_vegetables_proxy",
]);

/** Too much to chew on for a snack: anything that needs a knife and a plate. */
const NOT_A_SNACK = new Set([
  "chicken_peri_peri_negrita",
  "chicken_teriyaki_negrita",
  "chicken_mushroom_negrita",
  "beef_tenderloin_raw",
  "salmon_atlantic_raw",
  "wagyu_ground_raw_proxy",
  "rice_jasmine_cooked_proxy",
  "potato_roasted",
  "paratha_wholewheat",
]);

/**
 * The hard ingredient rule, exposed on its own so composed meals can be checked
 * against it directly. A composed meal carries its archetype's classified slots,
 * which would otherwise short-circuit `mealSlotEligibility` before the
 * ingredient rules ran and let a dinner-only cut through on the template alone.
 */
export function isDinnerOnlyIngredient(ingredientId: string): boolean {
  return DINNER_ONLY.has(ingredientId);
}

export function isNotASnackIngredient(ingredientId: string): boolean {
  return NOT_A_SNACK.has(ingredientId);
}

const BREAKFAST_MAIN_WORDS =
  /chicken breast|chicken plate|steak plate|peri.?peri chicken|teriyaki chicken|kebab|kofta|wagyu|curry|rendang|satay/i;
const SNACK_WORDS = /snack|shake|smoothie|yogurt|fruit|banana|toast|bread/i;

function requestedMealType(slot: string): string {
  const lower = slot.toLowerCase();
  if (/breakfast|brunch|morning/.test(lower)) return "breakfast";
  if (/snack/.test(lower)) return "snack";
  if (/pre-?workout/.test(lower)) return "pre-workout";
  if (/post-?workout/.test(lower)) return "post-workout";
  if (/lunch/.test(lower)) return "lunch";
  return "dinner";
}

/**
 * Hard culinary eligibility. Curated normalized metadata wins, followed by
 * normalized ingredient identities; names are deliberately only a fallback.
 * Macro amounts are not an input because a provisional slot allocation must
 * never turn an otherwise appropriate meal into an ineligible one.
 */
export function mealSlotEligibility(input: SlotEligibilityInput): SlotEligibilityResult {
  const kind = slotKindOf(input.slot);
  const requested = requestedMealType(input.slot);
  const classified = input.eligibleMealTypes?.map((type) => type.toLowerCase());
  if (classified?.length) {
    if (classified.includes(requested) ||
        (kind === "snack" && classified.some((type) => /snack|workout/.test(type)))) {
      return { allowed: true, reason: "ELIGIBLE_CLASSIFIED_SLOT" };
    }
    return { allowed: false, reason: "INELIGIBLE_CLASSIFIED_SLOT",
      explanation: `Classified ${input.mealArchetype ?? "meal"} is not offered for ${requested}.` };
  }

  const ingredients = input.ingredients ?? [];
  const ids = ingredients.map((item) => item.ingredientId);
  const ingredientText = ingredients.map((item) =>
    `${item.ingredientId} ${item.name ?? ""}`).join(" ").toLowerCase();
  if (kind === "breakfast" && ingredients.length) {
    if (ids.some((id) => DINNER_ONLY.has(id)) || BREAKFAST_MAIN_WORDS.test(ingredientText)) {
      return { allowed: false, reason: "INELIGIBLE_BREAKFAST_MAIN",
        explanation: "A lunch or dinner main is not an appropriate breakfast." };
    }
    if (ids.some((id) => BREAKFAST_FRIENDLY.has(id)) ||
        /egg|yogurt|cottage|smoked salmon|oat|buckwheat|fruit|bread|avocado/.test(ingredientText)) {
      return { allowed: true, reason: "ELIGIBLE_COMPATIBLE_INGREDIENTS" };
    }
  } else if (kind === "snack" && ingredients.length) {
    const heavy = ingredients.some((item) => NOT_A_SNACK.has(item.ingredientId) &&
      (item.grams ?? 300) >= 100);
    if (heavy) return { allowed: false, reason: "INELIGIBLE_HEAVY_SNACK",
      explanation: "A full plated main is too heavy for a snack slot." };
    if (/shake|smoothie|yogurt|fruit|banana|bread|toast/.test(ingredientText)) {
      return { allowed: true, reason: "ELIGIBLE_COMPATIBLE_INGREDIENTS" };
    }
  } else if (kind === "main" && ingredients.length) {
    return { allowed: true, reason: "ELIGIBLE_COMPATIBLE_INGREDIENTS" };
  }

  const name = input.name ?? "";
  if (kind === "breakfast" && BREAKFAST_MAIN_WORDS.test(name)) {
    return { allowed: false, reason: "INELIGIBLE_BREAKFAST_MAIN" };
  }
  if ((kind === "breakfast" && BREAKFASTY_WORDS.test(name)) ||
      (kind === "snack" && SNACK_WORDS.test(name))) {
    return { allowed: true, reason: "ELIGIBLE_NAME_FALLBACK" };
  }
  return { allowed: false, reason: kind === "snack" ? "INELIGIBLE_HEAVY_SNACK" :
    "INELIGIBLE_UNRECOGNIZED", explanation: "No compatible slot classification was found." };
}

/**
 * Penalties added to a candidate's score, sized against the planner's variety penalties (a repeated meal costs 1.2, a
 * repeated protein 0.45). Eating bacon twice in a week is a much smaller
 * problem than eating peri peri chicken at breakfast once, so being wrong for
 * the time of day has to outweigh being repetitive.
 */
const WRONG_TIME_PENALTY = 1.8;
const MILDLY_WRONG_PENALTY = 0.45;
const RIGHT_TIME_BONUS = -0.25;

/**
 * The protein decides whether a meal reads as breakfast; the side rarely
 * rescues it. Weighting the anchor stops "peri peri chicken + hash brown" from
 * averaging its way down to something acceptable.
 */
const ANCHOR_WEIGHT = 3;

/** How well one ingredient suits a slot. Lower is better, as with every score. */
export function ingredientSlotPenalty(
  ingredientId: string,
  kind: SlotKind
): number {
  if (kind === "breakfast") {
    if (DINNER_ONLY.has(ingredientId)) return WRONG_TIME_PENALTY;
    if (BREAKFAST_FRIENDLY.has(ingredientId)) return RIGHT_TIME_BONUS;
    return MILDLY_WRONG_PENALTY * 0.5; // neutral-ish: rice, potato, corn
  }

  if (kind === "snack") {
    if (NOT_A_SNACK.has(ingredientId)) return WRONG_TIME_PENALTY;
    return 0;
  }

  // Main meals: breakfast-only items feel thin as a dinner, but only mildly —
  // eggs for dinner is a real meal, brioche as a main course is not.
  if (kind === "main" && BREAKFAST_FRIENDLY.has(ingredientId)) {
    return MILDLY_WRONG_PENALTY * 0.4;
  }
  return 0;
}

/**
 * Suitability of a whole meal.
 *
 * A weighted average rather than a sum, so a four-component breakfast is not
 * punished four times over for one odd item — but the first component is taken
 * to be the anchor protein and counts for more, because that is what actually
 * determines whether the plate looks like breakfast.
 */
export function mealSlotPenalty(
  ingredientIds: string[],
  slot: string
): number {
  if (ingredientIds.length === 0) return 0;
  const kind = slotKindOf(slot);

  let weighted = 0;
  let weight = 0;
  ingredientIds.forEach((id, index) => {
    const w = index === 0 ? ANCHOR_WEIGHT : 1;
    weighted += w * ingredientSlotPenalty(id, kind);
    weight += w;
  });
  return weighted / weight;
}

/**
 * Negrita's own menu sections, which are a far better signal than the name.
 *
 * Guessing from words missed "Thai Boy - Beefy" and "Unagi Shogun" at
 * breakfast, because no regex is going to know those are dinner. The menu
 * already groups every dish, so use that and keep the word list only for saved
 * dishes people name themselves.
 */
const SECTION_KIND: Record<string, SlotKind> = {
  breakfast_and_sweets: "breakfast",
  fitness_meals: "main",
  kebab_combo: "main",
};

/**
 * Suitability of a menu dish, from the section the restaurant filed it under.
 * Returns null when the section is unknown, so the caller can fall back.
 */
export function sectionSlotPenalty(
  section: string | undefined,
  slot: string
): number | null {
  const belongsTo = section ? SECTION_KIND[section] : undefined;
  if (!belongsTo) return null;

  const kind = slotKindOf(slot);
  if (kind === belongsTo) return RIGHT_TIME_BONUS;

  // A dinner plate at breakfast is the jarring case; the reverse is milder,
  // since a breakfast dish is usually just light for an evening meal.
  if (kind === "breakfast" && belongsTo === "main") return WRONG_TIME_PENALTY;
  if (kind === "main" && belongsTo === "breakfast") return MILDLY_WRONG_PENALTY;
  if (kind === "snack") return MILDLY_WRONG_PENALTY;
  return 0;
}

/**
 * Saved dishes are matched by name, since a dish someone built themselves has
 * no section to consult.
 */
const DINNERY_WORDS =
  /steak|kebab|kofta|peri.?peri|teriyaki|mushroom sauce|wagyu|curry|rendang|satay|burger|bowl of rice/i;
const BREAKFASTY_WORDS =
  /breakfast|omelet|omelette|scrambl|benedict|pancake|waffle|granola|porridge|oat|toast|croissant|smoothie|yogurt|acai|banana bread/i;

export function namedDishSlotPenalty(name: string, slot: string): number {
  const kind = slotKindOf(slot);
  if (kind === "breakfast") {
    if (BREAKFASTY_WORDS.test(name)) return RIGHT_TIME_BONUS;
    if (DINNERY_WORDS.test(name)) return WRONG_TIME_PENALTY;
    return MILDLY_WRONG_PENALTY * 0.5;
  }
  if (kind === "main" && BREAKFASTY_WORDS.test(name)) {
    return MILDLY_WRONG_PENALTY * 0.4;
  }
  return 0;
}

/**
 * Which slots a day is allowed to go without.
 *
 * A snack is a convenience, not a requirement: the target belongs to the whole
 * day, and a day that reaches it in three meals is a complete day. Everything
 * else must still be filled. If a plan is *only* snacks then they are what the
 * day is made of, so none of them is optional.
 */
export function optionalSlots(slots: string[]): Set<string> {
  const optional = slots.filter((slot) => slotKindOf(slot) === "snack");
  return optional.length === slots.length ? new Set() : new Set(optional);
}

/** Whether every slot a day actually needs has something in it. */
export function dayIsComplete(
  slots: string[],
  filled: (slot: string) => boolean
): boolean {
  const optional = optionalSlots(slots);
  return slots.every((slot) => optional.has(slot) || filled(slot));
}
