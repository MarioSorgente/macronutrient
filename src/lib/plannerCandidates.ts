import { sumDishMacros } from "@/lib/calc";
import { getIngredient, nutritionCatalog, publishedMenuMacros } from "@/lib/database";
import { archetypeForCourse, classifyCourse, mealTimesForCourse } from "@/lib/mealTime";
import { menuRecipeForDish } from "@/lib/menuIdentity";
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

/**
 * Culinary style for a dish nobody curated — a saved or custom one. Named the
 * way a person would: what is on the plate, not which archetype it satisfies.
 * Ready Negrita dishes carry a hand-written style instead, and composed meals
 * derive theirs from the template they were built from.
 */
const stylePatterns: [string, RegExp][] = [
  ["pancake", /pancake|syrniki|crepe/],
  ["waffle", /waffle/],
  ["oatmeal", /oat|porridge|granola|muesli/],
  ["bakery", /banana bread|muffin|croissant|brioche|scone|pastry/],
  ["cheesecake", /cheese ?cake|dessert/],
  ["fruit-and-toast", /fruit|banana|berry|smoothie|acai/],
  ["eggs-savoury", /egg|omelet|omelette|scrambl|benedict|frittata/],
  ["cured-meat-savoury", /bacon|ham|sausage|prosciutto/],
  ["smoked-fish", /smoked salmon|lox|smoked fish/],
  ["yogurt-bowl", /yogurt|skyr|cottage/],
  ["burger", /burger/],
  ["kebab-plate", /kebab|kofta|gyro|pita|shawarma/],
  ["salad", /salad/],
  ["wrap", /wrap|burrito|tortilla/],
  ["rice-bowl", /rice bowl|donburi|poke/],
  ["noodles", /noodle|pasta|ramen|pho/],
  ["soup", /soup|broth|stew/],
];

function dishStyle(name: string, items: PlannerCandidateIngredient[],
  archetype: string): string {
  const text = `${name} ${ingredientText(items)}`.toLowerCase();
  const matched = stylePatterns.find(([, pattern]) => pattern.test(text))?.[0];
  // Falling back to the archetype keeps every candidate comparable: an
  // unrecognised dish is still counted against other dishes of its own kind
  // rather than dropping out of style accounting entirely.
  return matched ?? archetype;
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

function publishedConfidence(recipe: MenuRecipe): MacroConfidence {
  const record = recipe.menu_macros_per_serving;
  if (record.macro_confidence) return record.macro_confidence;
  const qualification = `${record.estimate_confidence ?? ""} ${record.source ?? ""}`.toLowerCase();
  return /incomplete/.test(qualification) ? "incomplete"
    : /estimat|uncertain|proxy/.test(qualification) ? "estimated"
    : "published";
}

function finish(base: Omit<PlannerCandidate, "proteinFamily" | "carbFamily" | "cuisineFamily" |
  "mealArchetype" | "dishStyle" | "eligibleMealTypes" | "modificationOptions" |
  "dietaryTags" | "allergenTags" | "sauceFamilies" | "readyMadePriority">,
  section = ""): PlannerCandidate {
  const families = normalizedFamilies(base.breakdown);
  // One vocabulary, shared with slotSuitability. The regex that used to live
  // here did not contain "banana bread", so a saved loaf was classified a main
  // and offered for lunch.
  const course = classifyCourse({ name: base.displayName, section,
    ingredients: base.breakdown });
  const archetype = archetypeForCourse(course);
  const classified = tags(base.breakdown);
  return { ...base, ...families, cuisineFamily: cuisineFamily(base.displayName, base.breakdown),
    mealArchetype: archetype,
    dishStyle: dishStyle(base.displayName, base.breakdown, archetype),
    eligibleMealTypes: mealTimesForCourse(course),
    modificationOptions: [], readyMadePriority: "normal",
    dietaryTags: classified.dietary, allergenTags: classified.allergens,
    sauceFamilies: classified.sauces };
}

export function savedDishCandidate(dish: Dish): PlannerCandidate | null {
  const items = breakdown(dish.items);
  const macros = sumDishMacros(dish.items);
  if (!items.length || macros.energy_kcal <= 0) return null;
  const price = priceItems(dish.items);
  const generic = finish({ id: `saved:${dish.id}`, source: "saved_dish", displayName: dish.name,
    optimizerMacros: macros, calculatedIngredientMacros: macros, breakdown: items, price,
    macroConfidence: "calculated",
    exactDishIdentity: `saved:${dish.id}` });

  // A saved copy of a Negrita dish is still that dish, so it keeps the curated
  // classification rather than being re-derived from its name. Only the
  // culinary facts are taken: the macros here are calculated from the saved
  // items and may legitimately differ from the published ones.
  const asMenu = menuRecipeForDish(dish);
  const curated = asMenu ? NEGRITA_PLANNER_METADATA[asMenu.recipe_id] : undefined;
  return curated ? { ...generic,
    proteinFamily: curated.proteinFamily,
    carbFamily: curated.carbFamily,
    cuisineFamily: curated.cuisineFamily,
    mealArchetype: curated.mealArchetype,
    dishStyle: curated.dishStyle,
    eligibleMealTypes: curated.eligibleMealTypes } : generic;
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
  const optimizerMacros = publishedMenuMacros(recipe) ?? calculatedIngredientMacros;
  const metadata = NEGRITA_PLANNER_METADATA[recipe.recipe_id];
  if (!metadata) return null;
  const generic = finish({ id: `menu:${recipe.recipe_id}`, source: "negrita_menu",
    displayName: recipe.name, optimizerMacros, calculatedIngredientMacros,
    breakdown: breakdown(dishItems),
    price: { totalIdr: recipe.price_idr ?? 0, complete: recipe.price_idr !== null },
    macroConfidence: publishedMenuMacros(recipe) ? publishedConfidence(recipe) : "incomplete",
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
    ...(includeMenu ? nutritionCatalog.menuRecipes.map(negritaMenuCandidate) : []),
  ].filter((candidate): candidate is PlannerCandidate => candidate !== null);
}
