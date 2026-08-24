import { sumDishMacros } from "@/lib/calc";
import { getIngredient, menuRecipes } from "@/lib/database";
import { priceItems } from "@/lib/pricing";
import { GRAM_UNIT_ID, type Macros, type MenuRecipe, type PlannerCandidate,
  type PlannerCandidateIngredient, type ProteinFamily, type CarbFamily,
  type MacroConfidence } from "@/types/nutrition";
import type { Dish, DishItem, ProteinSource } from "@/lib/storage/types";
import { NEGRITA_PLANNER_METADATA } from "@/lib/negritaPlannerMetadata";

const proteinPatterns: [ProteinFamily, RegExp][] = [
  ["chicken", /chicken/], ["beef", /beef|wagyu|steak|tenderloin/],
  // Pork before fish: "bacon" and "ham" would otherwise fall through to the
  // vegetarian/other bucket and make a bacon breakfast invisible to both the
  // protein lean and the weekly variety counters.
  ["pork", /bacon|(^|[^a-z])ham([^a-z]|$)|pork|prosciutto|pancetta/],
  ["fish", /fish|salmon|tuna|anchovy|tobiko|scallop|eel|shrimp|prawn/],
  ["eggs", /(^|_)egg/],
];

/**
 * The protein lean is expressed in the vocabulary a person uses; candidates are
 * normalized into families. One mapping, applied to menu dishes, saved dishes
 * and generated meals alike, so "more fish" reaches a salmon menu dish exactly
 * as it reaches a salmon plate the planner composed itself.
 */
const LEAN_SOURCE_BY_FAMILY: Partial<Record<ProteinFamily, ProteinSource>> = {
  chicken: "chicken", beef: "beef", pork: "pork", fish: "fish", eggs: "eggs",
  vegetarian: "veg",
};

export function proteinLeanSourceOf(family: ProteinFamily): ProteinSource | null {
  return LEAN_SOURCE_BY_FAMILY[family] ?? null;
}

/** Whether a candidate's normalized protein family is one the plan leans toward. */
export function candidateIsLeaned(family: ProteinFamily,
  proteinLean: readonly ProteinSource[]): boolean {
  if (!proteinLean.length) return false;
  const source = proteinLeanSourceOf(family);
  return source !== null && proteinLean.includes(source);
}

const carbPatterns: [CarbFamily, RegExp][] = [
  ["rice", /rice/], ["buckwheat", /buckwheat/], ["oats", /oat|granola|porridge/],
  ["potato", /potato|hash.brown/],
  ["bread", /bread|toast|bun|pita|paratha|brioche|sourdough/],
  ["wrap", /wrap|tortilla|burrito/],
  // Pulses and quinoa carried the "other" label, which made a week built almost
  // entirely on chickpeas look varied to the repeat counters.
  ["quinoa", /quinoa/], ["legume", /chickpea|lentil|(^|[^a-z])beans?([^a-z]|$)/],
];

function ingredientText(items: PlannerCandidateIngredient[]): string {
  return items.map((item) => `${item.ingredientId} ${item.name}`).join(" ").toLowerCase();
}

export function normalizedFamilies(items: PlannerCandidateIngredient[]): {
  proteinFamily: ProteinFamily; carbFamily: CarbFamily;
} {
  const text = ingredientText(items);
  const proteinFamily = proteinPatterns.find(([, pattern]) => pattern.test(text))?.[0]
    ?? (items.some((item) => {
      const category = getIngredient(item.ingredientId)?.category;
      return category === "legume" || category === "dairy";
    }) ? "vegetarian" : "other");
  const carbFamily = carbPatterns.find(([, pattern]) => pattern.test(text))?.[0] ?? "other";
  return { proteinFamily, carbFamily };
}

function cuisineFamily(name: string, items: PlannerCandidateIngredient[]): string {
  const text = `${name} ${ingredientText(items)}`.toLowerCase();
  if (/teriyaki|miso|tobiko|sushi/.test(text)) return "japanese";
  if (/peri.?peri/.test(text)) return "peri_peri";
  if (/curry|tikka|masala/.test(text)) return "south_asian";
  if (/sambal/.test(text)) return "indonesian";
  if (/pesto|bolognese|marinara/.test(text)) return "italian";
  return "neutral";
}

function mealMetadata(name: string, section = ""): { archetype: string; eligible: string[] } {
  const text = `${name} ${section}`.toLowerCase();
  if (/breakfast|oat|pancake|waffle|toast|egg/.test(text)) {
    return { archetype: "breakfast", eligible: ["breakfast"] };
  }
  if (/snack|dessert|smoothie|shake/.test(text)) {
    return { archetype: "snack", eligible: ["snack", "pre-workout", "post-workout"] };
  }
  return { archetype: "main", eligible: ["lunch", "dinner"] };
}

function tags(items: PlannerCandidateIngredient[]): { dietary: string[]; allergens: string[]; sauces: string[] } {
  const text = ingredientText(items);
  const ingredients = items.map((item) => getIngredient(item.ingredientId)).filter(Boolean);
  const flags = ingredients.flatMap((item) => item?.flags ?? []).map((flag) => flag.toLowerCase());
  const allergens = new Set<string>();
  if (/egg/.test(text)) allergens.add("egg");
  if (/milk|cheese|yogurt|whey|cream/.test(text)) allergens.add("dairy");
  if (/wheat|bread|wrap|tortilla/.test(text)) allergens.add("gluten");
  if (/fish|salmon|tuna|anchovy|tobiko|eel/.test(text)) allergens.add("fish");
  if (/shrimp|prawn|scallop/.test(text)) allergens.add("shellfish");
  flags.filter((flag) => /allerg/.test(flag)).forEach((flag) => allergens.add(flag));
  const vegetarian = normalizedFamilies(items).proteinFamily === "vegetarian";
  const sauces = items.filter((item) => /sauce|dressing|sambal|pesto|teriyaki|peri/.test(
    `${item.ingredientId} ${item.name}`.toLowerCase())).map((item) => item.ingredientId);
  return { dietary: vegetarian ? ["vegetarian"] : [], allergens: [...allergens], sauces };
}

function breakdown(items: DishItem[]): PlannerCandidateIngredient[] {
  return items.map((item) => ({ ingredientId: item.ingredientId, name: item.name,
    grams: item.grams, preparation: getIngredient(item.ingredientId)?.notes ?? undefined }));
}

const MACRO_KEYS: (keyof Macros)[] = [
  "energy_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g",
];

function publishedMacros(recipe: MenuRecipe): Macros | null {
  const macros = recipe.menu_macros_per_serving;
  return MACRO_KEYS.every((key) => Number.isFinite(macros[key]))
    ? Object.fromEntries(MACRO_KEYS.map((key) => [key, macros[key]])) as unknown as Macros
    : null;
}

function publishedConfidence(recipe: MenuRecipe): MacroConfidence {
  const record = recipe.menu_macros_per_serving;
  if (record.macro_confidence) return record.macro_confidence;
  const qualification = `${record.estimate_confidence ?? ""} ${record.source ?? ""}`.toLowerCase();
  return /incomplete/.test(qualification) ? "incomplete"
    : /estimat|uncertain|proxy/.test(qualification) ? "estimated"
    : "published";
}

function finish(base: Omit<PlannerCandidate, "proteinFamily" | "carbFamily" | "cuisineFamily" |
  "mealArchetype" | "eligibleMealTypes" | "modificationOptions" | "dietaryTags" |
  "allergenTags" | "sauceFamilies" | "readyMadePriority">, section = ""): PlannerCandidate {
  const families = normalizedFamilies(base.breakdown);
  const meal = mealMetadata(base.displayName, section);
  const classified = tags(base.breakdown);
  return { ...base, ...families, cuisineFamily: cuisineFamily(base.displayName, base.breakdown),
    mealArchetype: meal.archetype, eligibleMealTypes: meal.eligible,
    modificationOptions: [], readyMadePriority: "normal",
    dietaryTags: classified.dietary, allergenTags: classified.allergens,
    sauceFamilies: classified.sauces };
}

export function savedDishCandidate(dish: Dish): PlannerCandidate | null {
  const items = breakdown(dish.items);
  const macros = sumDishMacros(dish.items);
  if (!items.length || macros.energy_kcal <= 0) return null;
  const price = priceItems(dish.items);
  return finish({ id: `saved:${dish.id}`, source: "saved_dish", displayName: dish.name,
    optimizerMacros: macros, calculatedIngredientMacros: macros, breakdown: items, price,
    macroConfidence: "calculated",
    exactDishIdentity: `saved:${dish.id}` });
}

export function negritaMenuCandidate(recipe: MenuRecipe): PlannerCandidate | null {
  const dishItems: DishItem[] = recipe.components.flatMap((component) => {
    const ingredient = getIngredient(component.ingredient_id);
    return ingredient && component.quantity_g ? [{ ingredientId: component.ingredient_id,
      name: ingredient.name, grams: component.quantity_g, unitId: GRAM_UNIT_ID,
      quantity: component.quantity_g }] : [];
  });
  if (!dishItems.length) return null;
  const calculatedIngredientMacros = sumDishMacros(dishItems);
  const optimizerMacros = publishedMacros(recipe) ?? calculatedIngredientMacros;
  const metadata = NEGRITA_PLANNER_METADATA[recipe.recipe_id];
  if (!metadata) return null;
  const generic = finish({ id: `menu:${recipe.recipe_id}`, source: "negrita_menu",
    displayName: recipe.name, optimizerMacros, calculatedIngredientMacros,
    breakdown: breakdown(dishItems),
    price: { totalIdr: recipe.price_idr ?? 0, complete: recipe.price_idr !== null },
    macroConfidence: publishedMacros(recipe) ? publishedConfidence(recipe) : "incomplete",
    exactDishIdentity: `menu:${recipe.recipe_id}` }, recipe.section);
  return { ...generic, ...metadata, readyMadePriority: "high" };
}

/** Apply only a kitchen-approved fixed delta; unknown modifications are unavailable. */
export function macrosWithApprovedModification(candidate: PlannerCandidate,
  optionIndex: number): Macros | null {
  const option = candidate.modificationOptions[optionIndex];
  if (!option) return null;
  return Object.fromEntries(MACRO_KEYS.map((key) =>
    [key, candidate.optimizerMacros[key] + option.macroDelta[key]])) as unknown as Macros;
}

export function generatedDiyCandidate(input: { id: string; name: string; items: DishItem[];
  macros: Macros; priceIdr: number }): PlannerCandidate {
  return finish({ id: `diy:${input.id}`, source: "generated_diy", displayName: input.name,
    optimizerMacros: input.macros, breakdown: breakdown(input.items),
    calculatedIngredientMacros: input.macros,
    price: { totalIdr: input.priceIdr, complete: true }, macroConfidence: "calculated",
    exactDishIdentity: `diy:${input.id}` });
}

/** The ready-made portion of the unified catalog; DIY candidates join it per target. */
export function readyPlannerCatalog(saved: Dish[], includeMenu: boolean): PlannerCandidate[] {
  return [
    ...saved.map(savedDishCandidate),
    ...(includeMenu ? menuRecipes.map(negritaMenuCandidate) : []),
  ].filter((candidate): candidate is PlannerCandidate => candidate !== null);
}
